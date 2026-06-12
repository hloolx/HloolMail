package smtpserver

import (
	"context"
	"log/slog"
	"net"
	"sync"
	"time"

	"gptmail/internal/config"
	"gptmail/internal/domain"
	"gptmail/internal/events"
	"gptmail/internal/ratelimit"

	gosmtp "github.com/emersion/go-smtp"
	"golang.org/x/time/rate"
	"gorm.io/gorm"
)

type Service struct {
	Config   config.Config
	DB       *gorm.DB
	Resolver domain.Resolver
	Hub      *events.Hub
}

func Start(ctx context.Context, service Service) *gosmtp.Server {
	server := gosmtp.NewServer(&Backend{Service: service})
	server.Addr = service.Config.SMTPAddr
	server.Domain = service.Config.MailHostname
	server.MaxMessageBytes = service.Config.MaxMessageBytes
	server.MaxRecipients = 100

	go func() {
		network, addr := smtpListenAddress(server)
		slog.Info("smtp listening", "addr", addr)
		listener, err := net.Listen(network, addr)
		if err != nil {
			if ctx.Err() == nil {
				slog.Error("smtp listen failed", "addr", addr, "error", err)
			}
			return
		}
		throttled := newThrottledListener(listener, ratelimit.New(), defaultSMTPThrottleConfig())
		if err := server.Serve(throttled); err != nil && ctx.Err() == nil {
			slog.Error("smtp server stopped", "error", err)
		}
	}()
	return server
}

func smtpListenAddress(server *gosmtp.Server) (string, string) {
	network := server.Network
	if network == "" {
		if server.LMTP {
			network = "unix"
		} else {
			network = "tcp"
		}
	}
	addr := server.Addr
	if addr == "" && !server.LMTP {
		addr = ":smtp"
	}
	return network, addr
}

type smtpThrottleConfig struct {
	Rate          rate.Limit
	Burst         int
	MaxConcurrent int
}

func defaultSMTPThrottleConfig() smtpThrottleConfig {
	return smtpThrottleConfig{
		Rate:          rate.Limit(1),
		Burst:         5,
		MaxConcurrent: 10,
	}
}

type throttledListener struct {
	net.Listener
	limiter *ratelimit.Limiter
	guard   *smtpConnectionGuard
	cfg     smtpThrottleConfig
}

func newThrottledListener(listener net.Listener, limiter *ratelimit.Limiter, cfg smtpThrottleConfig) net.Listener {
	if limiter == nil {
		limiter = ratelimit.New()
	}
	if cfg.Rate <= 0 {
		cfg.Rate = rate.Limit(1)
	}
	if cfg.Burst <= 0 {
		cfg.Burst = 1
	}
	return &throttledListener{
		Listener: listener,
		limiter:  limiter,
		guard:    newSMTPConnectionGuard(cfg.MaxConcurrent),
		cfg:      cfg,
	}
}

func (l *throttledListener) Accept() (net.Conn, error) {
	for {
		conn, err := l.Listener.Accept()
		if err != nil {
			return nil, err
		}
		ip := remoteIP(conn.RemoteAddr())
		if !l.limiter.Allow("smtp:"+ip, l.cfg.Rate, l.cfg.Burst) {
			closeSMTPConn(conn, "421 rate limit exceeded\r\n")
			continue
		}
		if !l.guard.acquire(ip) {
			closeSMTPConn(conn, "421 too many connections\r\n")
			continue
		}
		return &guardedConn{
			Conn:    conn,
			release: func() { l.guard.release(ip) },
		}, nil
	}
}

type smtpConnectionGuard struct {
	mu            sync.Mutex
	active        map[string]int
	maxConcurrent int
}

func newSMTPConnectionGuard(maxConcurrent int) *smtpConnectionGuard {
	return &smtpConnectionGuard{
		active:        make(map[string]int),
		maxConcurrent: maxConcurrent,
	}
}

func (g *smtpConnectionGuard) acquire(ip string) bool {
	if g == nil || g.maxConcurrent <= 0 {
		return true
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.active[ip] >= g.maxConcurrent {
		return false
	}
	g.active[ip]++
	return true
}

func (g *smtpConnectionGuard) release(ip string) {
	if g == nil || g.maxConcurrent <= 0 {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.active[ip] <= 1 {
		delete(g.active, ip)
		return
	}
	g.active[ip]--
}

type guardedConn struct {
	net.Conn
	once    sync.Once
	release func()
}

func (c *guardedConn) Close() error {
	c.once.Do(c.release)
	return c.Conn.Close()
}

func remoteIP(addr net.Addr) string {
	if addr == nil {
		return "unknown"
	}
	host, _, err := net.SplitHostPort(addr.String())
	if err != nil || host == "" {
		return addr.String()
	}
	return host
}

func closeSMTPConn(conn net.Conn, message string) {
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	_, _ = conn.Write([]byte(message))
	_ = conn.Close()
}

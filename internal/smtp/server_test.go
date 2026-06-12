package smtpserver

import (
	"net"
	"testing"
	"time"

	"gptmail/internal/ratelimit"

	"golang.org/x/time/rate"
)

func TestSMTPConnectionGuardLimitsAndReleasesPerIP(t *testing.T) {
	guard := newSMTPConnectionGuard(2)
	if !guard.acquire("203.0.113.1") {
		t.Fatal("first acquire failed")
	}
	if !guard.acquire("203.0.113.1") {
		t.Fatal("second acquire failed")
	}
	if guard.acquire("203.0.113.1") {
		t.Fatal("third acquire succeeded, want limit")
	}
	if !guard.acquire("203.0.113.2") {
		t.Fatal("different IP should have its own concurrency bucket")
	}
	guard.release("203.0.113.1")
	if !guard.acquire("203.0.113.1") {
		t.Fatal("acquire after release failed")
	}
}

func TestGuardedConnReleasesOnlyOnce(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()

	releases := 0
	conn := &guardedConn{
		Conn: server,
		release: func() {
			releases++
		},
	}
	_ = conn.Close()
	_ = conn.Close()
	if releases != 1 {
		t.Fatalf("release count = %d, want 1", releases)
	}
}

func TestThrottledListenerRejectsConcurrentConnections(t *testing.T) {
	inner := newFakeListener(
		newFakeConn("198.51.100.7:2525"),
		newFakeConn("198.51.100.7:2525"),
	)
	listener := newThrottledListener(inner, ratelimit.NewWithOptions(ratelimit.Options{CleanupInterval: 0}), smtpThrottleConfig{
		Rate:          rate.Inf,
		Burst:         1,
		MaxConcurrent: 1,
	})

	first, err := listener.Accept()
	if err != nil {
		t.Fatalf("first Accept() error: %v", err)
	}
	defer first.Close()

	if _, err := listener.Accept(); err == nil {
		t.Fatal("second Accept() succeeded, want listener exhaustion after concurrent connection is closed")
	}
	second := inner.conns[1]
	if !second.closed {
		t.Fatal("concurrency-limited connection was not closed")
	}
	if got := string(second.writes); got != "421 too many connections\r\n" {
		t.Fatalf("concurrency-limit response = %q", got)
	}
}

func TestThrottledListenerRejectsRateLimitedConnections(t *testing.T) {
	inner := newFakeListener(
		newFakeConn("198.51.100.7:2525"),
		newFakeConn("198.51.100.7:2525"),
	)
	listener := newThrottledListener(inner, ratelimit.NewWithOptions(ratelimit.Options{CleanupInterval: 0}), smtpThrottleConfig{
		Rate:          rate.Limit(0.0001),
		Burst:         1,
		MaxConcurrent: 10,
	})

	first, err := listener.Accept()
	if err != nil {
		t.Fatalf("first Accept() error: %v", err)
	}
	defer first.Close()

	if _, err := listener.Accept(); err == nil {
		t.Fatal("second Accept() succeeded, want listener exhaustion after rate-limited connection is closed")
	}
	second := inner.conns[1]
	if !second.closed {
		t.Fatal("rate-limited connection was not closed")
	}
	if got := string(second.writes); got != "421 rate limit exceeded\r\n" {
		t.Fatalf("rate-limit response = %q", got)
	}
}

func TestRemoteIPFallsBackWhenAddressIsNotHostPort(t *testing.T) {
	addr := fakeAddr("unix-socket")
	if got := remoteIP(addr); got != "unix-socket" {
		t.Fatalf("remoteIP = %q, want fallback address", got)
	}
}

type fakeListener struct {
	conns []*fakeConn
	next  int
}

func newFakeListener(conns ...*fakeConn) *fakeListener {
	return &fakeListener{conns: conns}
}

func (l *fakeListener) Accept() (net.Conn, error) {
	if l.next >= len(l.conns) {
		return nil, net.ErrClosed
	}
	conn := l.conns[l.next]
	l.next++
	return conn, nil
}

func (l *fakeListener) Close() error {
	return nil
}

func (l *fakeListener) Addr() net.Addr {
	return fakeAddr("127.0.0.1:2525")
}

type fakeConn struct {
	remote net.Addr
	writes []byte
	closed bool
}

func newFakeConn(remote string) *fakeConn {
	return &fakeConn{remote: fakeAddr(remote)}
}

func (c *fakeConn) Read(_ []byte) (int, error) {
	return 0, net.ErrClosed
}

func (c *fakeConn) Write(p []byte) (int, error) {
	c.writes = append(c.writes, p...)
	return len(p), nil
}

func (c *fakeConn) Close() error {
	c.closed = true
	return nil
}

func (c *fakeConn) LocalAddr() net.Addr {
	return fakeAddr("127.0.0.1:2525")
}

func (c *fakeConn) RemoteAddr() net.Addr {
	return c.remote
}

func (c *fakeConn) SetDeadline(_ time.Time) error {
	return nil
}

func (c *fakeConn) SetReadDeadline(_ time.Time) error {
	return nil
}

func (c *fakeConn) SetWriteDeadline(_ time.Time) error {
	return nil
}

type fakeAddr string

func (a fakeAddr) Network() string {
	return "tcp"
}

func (a fakeAddr) String() string {
	return string(a)
}

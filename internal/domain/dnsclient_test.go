package domain

import (
	"context"
	"net"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/miekg/dns"
)

func TestResolverTargetsRejectUnsafeResolverAddresses(t *testing.T) {
	var lookupCalled atomic.Bool
	restore := stubDNSLookupIP(t, func(context.Context, string) ([]net.IP, error) {
		lookupCalled.Store(true)
		return []net.IP{net.ParseIP("8.8.8.8")}, nil
	})
	defer restore()

	targets := resolverTargets(context.Background(), []string{
		"127.0.0.1:53",
		"10.0.0.1",
		"169.254.169.254",
		"192.0.2.1",
		"[::1]:53",
		"metadata.google.internal",
		"localhost",
	}, time.Second)
	if len(targets) != 0 {
		t.Fatalf("unsafe resolver targets were kept: %+v", targets)
	}
	if lookupCalled.Load() {
		t.Fatal("blocked resolver hostnames should not be resolved")
	}
}

func TestResolverTargetsKeepOnlyPublicResolvedAddresses(t *testing.T) {
	restore := stubDNSLookupIP(t, func(ctx context.Context, host string) ([]net.IP, error) {
		if host != "dns.example" {
			t.Fatalf("lookup host = %q, want dns.example", host)
		}
		return []net.IP{
			net.ParseIP("127.0.0.1"),
			net.ParseIP("8.8.8.8"),
			net.ParseIP("198.51.100.1"),
			net.ParseIP("2001:4860:4860::8888"),
		}, nil
	})
	defer restore()

	targets := resolverTargets(context.Background(), []string{"dns.example:5353"}, time.Second)
	got := make([]string, 0, len(targets))
	for _, target := range targets {
		got = append(got, target.address)
	}
	want := []string{"8.8.8.8:5353", "[2001:4860:4860::8888]:5353"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("resolver targets = %v, want %v", got, want)
	}
}

func TestExchangeDNSRejectsLoopbackResolverWithoutDialing(t *testing.T) {
	udpConn, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer udpConn.Close()

	tcpListener, err := net.Listen("tcp", udpConn.LocalAddr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer tcpListener.Close()

	var contacts atomic.Int32
	done := make(chan struct{})
	defer close(done)

	go func() {
		buf := make([]byte, 512)
		for {
			_ = udpConn.SetReadDeadline(time.Now().Add(20 * time.Millisecond))
			if _, _, err := udpConn.ReadFrom(buf); err == nil {
				contacts.Add(1)
				continue
			}
			select {
			case <-done:
				return
			default:
			}
		}
	}()

	go func() {
		for {
			_ = tcpListener.(*net.TCPListener).SetDeadline(time.Now().Add(20 * time.Millisecond))
			conn, err := tcpListener.Accept()
			if err == nil {
				contacts.Add(1)
				_ = conn.Close()
				continue
			}
			select {
			case <-done:
				return
			default:
			}
		}
	}()

	_, err = exchangeDNS(context.Background(), udpConn.LocalAddr().String(), "example.com", dns.TypeMX, false, 50*time.Millisecond)
	if err == nil || !strings.Contains(err.Error(), "not allowed") {
		t.Fatalf("exchangeDNS error = %v, want resolver blocked", err)
	}
	time.Sleep(50 * time.Millisecond)
	if contacts.Load() != 0 {
		t.Fatalf("loopback resolver received %d dns probes", contacts.Load())
	}
}

func stubDNSLookupIP(t *testing.T, lookup func(context.Context, string) ([]net.IP, error)) func() {
	t.Helper()
	original := dnsLookupIP
	dnsLookupIP = lookup
	return func() {
		dnsLookupIP = original
	}
}

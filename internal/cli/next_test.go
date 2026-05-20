package cli

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestMailNextWaitExtractsCode(t *testing.T) {
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/emails/next" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if r.URL.Query().Get("email") != "agent@example.test" {
			t.Fatalf("email query = %q", r.URL.Query().Get("email"))
		}
		if r.Header.Get("X-API-Key") != "secret" {
			t.Fatalf("api key header = %q", r.Header.Get("X-API-Key"))
		}
		w.Header().Set("Content-Type", "application/json")
		if atomic.AddInt32(&calls, 1) == 1 {
			fmt.Fprint(w, `{"success":true,"data":{"has_email":false,"message":null},"error":null}`)
			return
		}
		fmt.Fprint(w, `{"success":true,"data":{"has_email":true,"message":{"id":"m1","subject":"Verify","from_address":"noreply@example.test","text_content":"Your code is 123456"}},"error":null}`)
	}))
	defer server.Close()

	var stdout, stderr bytes.Buffer
	code := Execute(context.Background(), []string{
		"--base-url", server.URL,
		"--api-key", "secret",
		"--quiet",
		"mail", "next", "agent@example.test",
		"--wait", "100ms",
		"--interval", "1ms",
		"--code-regex", `\d{6}`,
	}, Runner{
		Stdout:     &stdout,
		Stderr:     &stderr,
		ConfigPath: defaultConfigPathFromDir(t.TempDir()),
		HTTPClient: server.Client(),
		Sleep: func(context.Context, time.Duration) error {
			return nil
		},
	})
	if code != ExitOK {
		t.Fatalf("exit code = %d, stderr = %q", code, stderr.String())
	}
	if got := strings.TrimSpace(stdout.String()); got != "123456" {
		t.Fatalf("stdout = %q, want 123456", stdout.String())
	}
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Fatalf("calls = %d, want 2", got)
	}
}

func TestMailNextWaitTimeoutExitCode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"success":true,"data":{"has_email":false,"message":null},"error":null}`)
	}))
	defer server.Close()

	var stdout, stderr bytes.Buffer
	code := Execute(context.Background(), []string{
		"--base-url", server.URL,
		"mail", "next", "agent@example.test",
		"--wait", "10ms",
		"--interval", "1ms",
	}, Runner{
		Stdout:     &stdout,
		Stderr:     &stderr,
		ConfigPath: defaultConfigPathFromDir(t.TempDir()),
		HTTPClient: server.Client(),
		Sleep: func(context.Context, time.Duration) error {
			return context.DeadlineExceeded
		},
	})
	if code != ExitWaitTimeout {
		t.Fatalf("exit code = %d, want %d", code, ExitWaitTimeout)
	}
	if !strings.Contains(stderr.String(), "timed out") {
		t.Fatalf("stderr = %q, want timeout message", stderr.String())
	}
	if stdout.Len() != 0 {
		t.Fatalf("stdout = %q, want empty", stdout.String())
	}
}

func TestCompileCodeRegexSupportsDigitEscape(t *testing.T) {
	re, err := compileCodeRegex(`\d{6}`)
	if err != nil {
		t.Fatalf("compileCodeRegex returned error: %v", err)
	}
	if got := re.FindString("code: 654321"); got != "654321" {
		t.Fatalf("regex match = %q", got)
	}
}

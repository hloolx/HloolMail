package cli

import (
	"bytes"
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestHTTPStatusToExitCode(t *testing.T) {
	tests := []struct {
		status  int
		message string
		want    int
	}{
		{http.StatusBadRequest, "bad request", ExitConfig},
		{http.StatusUnauthorized, "missing key", ExitAuth},
		{http.StatusForbidden, "forbidden", ExitAuth},
		{http.StatusNotFound, "missing", ExitNotFound},
		{http.StatusTooManyRequests, "rate limit exceeded", ExitQuota},
		{http.StatusForbidden, "quota exceeded", ExitQuota},
		{http.StatusRequestTimeout, "timeout", ExitNetwork},
		{http.StatusInternalServerError, "boom", ExitServer},
	}
	for _, tt := range tests {
		if got := mapHTTPStatusToExitCode(tt.status, tt.message); got != tt.want {
			t.Fatalf("mapHTTPStatusToExitCode(%d, %q) = %d, want %d", tt.status, tt.message, got, tt.want)
		}
	}
}

func TestDangerousMailDeleteRequiresYes(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := Execute(context.Background(), []string{"mail", "delete", "msg-1"}, Runner{
		Stdout:     &stdout,
		Stderr:     &stderr,
		ConfigPath: defaultConfigPathFromDir(t.TempDir()),
	})
	if code != ExitDangerous {
		t.Fatalf("exit code = %d, want %d", code, ExitDangerous)
	}
	if !strings.Contains(stderr.String(), "--yes") {
		t.Fatalf("stderr = %q, want --yes message", stderr.String())
	}
	if stdout.Len() != 0 {
		t.Fatalf("stdout = %q, want empty", stdout.String())
	}
}

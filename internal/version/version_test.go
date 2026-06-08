package version

import "testing"

func TestDefaultVersionIsDev(t *testing.T) {
	if Version != "dev" {
		t.Fatalf("default version = %q, want dev", Version)
	}
}

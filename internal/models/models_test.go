package models

import (
	"encoding/json"
	"testing"
)

func TestSanitizeAvatarURLAllowsOnlyHTTPS(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{name: "https", input: " https://example.com/avatar.png ", want: "https://example.com/avatar.png"},
		{name: "http", input: "http://example.com/avatar.png", want: ""},
		{name: "data", input: "data:image/png;base64,abc", want: ""},
		{name: "file", input: "file:///tmp/avatar.png", want: ""},
		{name: "relative", input: "/avatar.png", want: ""},
		{name: "missing host", input: "https:///avatar.png", want: ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := SanitizeAvatarURL(tc.input); got != tc.want {
				t.Fatalf("SanitizeAvatarURL(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestUserMarshalJSONFiltersUnsafeAvatarURL(t *testing.T) {
	raw, err := json.Marshal(User{
		ID:        1,
		Email:     "unsafe-avatar@example.com",
		Nickname:  "Unsafe Avatar",
		AvatarURL: "http://example.com/avatar.png",
	})
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	if _, exists := payload["avatar_url"]; exists {
		t.Fatalf("unsafe avatar_url was serialized: %s", string(raw))
	}
}

func TestUserMarshalJSONKeepsSafeAvatarURL(t *testing.T) {
	raw, err := json.Marshal(User{
		ID:        1,
		Email:     "safe-avatar@example.com",
		Nickname:  "Safe Avatar",
		AvatarURL: " https://example.com/avatar.png ",
	})
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["avatar_url"] != "https://example.com/avatar.png" {
		t.Fatalf("avatar_url = %v, want sanitized HTTPS URL; body=%s", payload["avatar_url"], string(raw))
	}
}

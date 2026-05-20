package apispec

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestOperationIDsUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, op := range Operations() {
		if op.ID == "" {
			t.Fatalf("operation with empty id: %+v", op)
		}
		if seen[op.ID] {
			t.Fatalf("duplicate operation id %q", op.ID)
		}
		seen[op.ID] = true
	}
}

func TestSpecScopeExcludesVersionedInternalAndStreams(t *testing.T) {
	doc := OpenAPIDocument(Config{BaseURL: "https://mail.example.com", Version: "test"})
	data, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	body := string(data)
	for _, forbidden := range []string{
		"/api/v1",
		"/api/admin",
		"/api/auth",
		"/api/oauth",
		"/api/user/",
		"/api/users",
		"/api/inbox-stream",
		"/api/notification-stream",
		"/api/announcement-stream",
		"/api/api-keys",
		"SSE",
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("OpenAPI document should not contain %q", forbidden)
		}
	}
	for path := range doc.Paths {
		if !strings.HasPrefix(path, "/api/") {
			t.Fatalf("path %q does not use /api prefix", path)
		}
	}
}

func TestShareAndWebhookManagementAreSessionOnly(t *testing.T) {
	for _, op := range Operations() {
		if strings.HasPrefix(op.Path, "/api/share-links") || strings.HasPrefix(op.Path, "/api/webhooks") {
			if op.Auth != AuthSession {
				t.Fatalf("%s %s auth = %s, want session", op.Method, op.Path, op.Auth)
			}
			if !hasTag(op.Tags, TagWebSession) {
				t.Fatalf("%s %s missing web session tag", op.Method, op.Path)
			}
		}
	}
}

func TestPublicShareSurfaceIsMailboxOnly(t *testing.T) {
	doc := OpenAPIDocument(Config{BaseURL: "https://mail.example.com", Version: "test"})
	data, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	body := string(data)
	for _, forbidden := range []string{
		"/api/shared/{token}/access",
		"PublicSharedMessage",
		"SharedAccessRequest",
		"password_required",
		"clear_password",
		`"password"`,
		"message share",
		"邮件分享",
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("OpenAPI document should not contain share/password main resource text %q", forbidden)
		}
	}
	wantPaths := map[string]bool{
		"/api/shared/{token}":                       false,
		"/api/shared/{token}/messages":              false,
		"/api/shared/{token}/messages/{message_id}": false,
	}
	for _, op := range PublicShareOperations() {
		seen, ok := wantPaths[op.Path]
		if !ok {
			t.Fatalf("unexpected public share operation path %q", op.Path)
		}
		if seen {
			t.Fatalf("duplicate public share operation path %q", op.Path)
		}
		wantPaths[op.Path] = true
	}
	for path, seen := range wantPaths {
		if !seen {
			t.Fatalf("missing public share operation path %q", path)
		}
	}
	assertSchemaOmitsProperties(t, doc, "ShareLink", "message_id", "password", "password_set", "clear_password")
	assertSchemaOmitsProperties(t, doc, "CreateShareLinkRequest", "message_id", "password", "clear_password")
	assertSchemaOmitsProperties(t, doc, "PatchShareLinkRequest", "message_id", "password", "clear_password")
	assertSchemaOmitsProperties(t, doc, "PublicSharedLocked", "message", "password", "password_required")
	assertSchemaOmitsProperties(t, doc, "ShareLinkAccessLog", "message_id", "password", "clear_password")
}

func TestMarkdownAndSkillStayOnPublicAutomationBoundary(t *testing.T) {
	for name, body := range map[string]string{
		"docs":  Markdown(Config{BaseURL: "https://mail.example.com"}),
		"skill": SkillMarkdown(Config{BaseURL: "https://mail.example.com"}),
	} {
		for _, forbidden := range []string{
			"/api/v1",
			"/api/admin",
			"/api/auth",
			"/api/oauth",
			"/api/user/",
			"/api/users",
			"/api/inbox-stream",
			"/api/notification-stream",
			"/api/announcement-stream",
			"/api/api-keys",
			"SSE",
			"/api/shared/:token/access",
			"PublicSharedMessage",
			"password_required",
			"clear_password",
			"message share",
			"邮件分享",
		} {
			if strings.Contains(body, forbidden) {
				t.Fatalf("%s should not contain %q", name, forbidden)
			}
		}
	}
}

func assertSchemaOmitsProperties(t *testing.T, doc OpenAPI, name string, forbidden ...string) {
	t.Helper()
	schema, ok := doc.Components.Schemas[name]
	if !ok {
		t.Fatalf("schema %q missing", name)
	}
	properties, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("schema %q properties missing", name)
	}
	for _, property := range forbidden {
		if _, ok := properties[property]; ok {
			t.Fatalf("schema %q should not expose property %q", name, property)
		}
	}
}

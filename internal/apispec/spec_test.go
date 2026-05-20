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

func TestMarkdownAndSkillStayOnPublicAutomationBoundary(t *testing.T) {
	for name, body := range map[string]string{
		"docs":  Markdown(Config{BaseURL: "https://mail.example.com"}),
		"skill": SkillMarkdown(Config{BaseURL: "https://mail.example.com"}),
	} {
		for _, forbidden := range []string{
			"/api/v1",
			"/api/admin",
			"/api/inbox-stream",
			"/api/notification-stream",
			"/api/announcement-stream",
			"/api/api-keys",
			"SSE",
		} {
			if strings.Contains(body, forbidden) {
				t.Fatalf("%s should not contain %q", name, forbidden)
			}
		}
	}
}

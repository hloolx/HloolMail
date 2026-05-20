package httpapi

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"gptmail/internal/models"
)

func TestMessageDTOHelpersKeepExistingResponseShape(t *testing.T) {
	now := time.Date(2026, 5, 20, 10, 30, 0, 0, time.UTC)
	msg := models.Message{
		ID:              "message-dto",
		Recipient:       "demo@example.test",
		RecipientLocal:  "demo",
		RecipientDomain: "example.test",
		RootDomain:      "example.test",
		FromAddress:     "sender@example.com",
		FromName:        "Sender",
		Subject:         "Subject",
		Seen:            true,
		TextContent:     "hello text",
		HTMLContent:     "<p>hello html</p>",
		HeadersJSON:     `{"x-test":"yes"}`,
		CreatedAt:       now,
		ExpiresAt:       now.Add(time.Hour),
	}

	summary := mustJSONMap(t, messageSummaryDTO(msg))
	assertJSONKeys(t, summary, "id", "recipient", "from_address", "from_name", "subject", "seen", "preview", "attachment_count", "created_at", "expires_at")
	if summary["preview"] != "hello text" {
		t.Fatalf("summary preview = %v", summary["preview"])
	}
	if summary["attachment_count"] != float64(0) {
		t.Fatalf("summary attachment_count = %v", summary["attachment_count"])
	}

	publicDetail := mustJSONMap(t, publicMessageDetail(msg))
	assertJSONKeys(t, publicDetail, "id", "recipient", "from_address", "from_name", "subject", "seen", "text_content", "headers_json", "attachment_count", "attachments", "created_at", "expires_at")
	if _, ok := publicDetail["html_content"]; ok {
		t.Fatalf("public detail should not include html_content: %+v", publicDetail)
	}
	if !hasJSONArray(publicDetail, "attachments") || publicDetail["attachment_count"] != float64(0) {
		t.Fatalf("public detail should include empty attachment metadata: %+v", publicDetail)
	}

	webDetail := mustJSONMap(t, webMessageDetail(msg))
	assertJSONKeys(t, webDetail, "id", "recipient", "from_address", "from_name", "subject", "seen", "text_content", "headers_json", "attachment_count", "attachments", "created_at", "expires_at", "html_content")
	if webDetail["html_content"] != "<p>hello html</p>" {
		t.Fatalf("web html_content = %v", webDetail["html_content"])
	}
	if !hasJSONArray(webDetail, "attachments") || webDetail["attachment_count"] != float64(0) {
		t.Fatalf("web detail should include empty attachment metadata: %+v", webDetail)
	}
}

func TestFutureMessageDTOHelpersSanitizeSharedAndWebhookHTML(t *testing.T) {
	now := time.Date(2026, 5, 20, 10, 30, 0, 0, time.UTC)
	msg := models.Message{
		ID:          "message-public",
		Recipient:   "demo@example.test",
		FromAddress: "sender@example.com",
		Subject:     "Subject",
		TextContent: "hello text",
		HTMLContent: `<p>hello</p><script>alert("x")</script>`,
		HeadersJSON: `{"x-test":"yes"}`,
		CreatedAt:   now,
		ExpiresAt:   now.Add(time.Hour),
	}

	shared := mustJSONMap(t, publicSharedMessageDTO(msg, nil))
	if _, ok := shared["headers_json"]; ok {
		t.Fatalf("shared DTO must not expose headers_json: %+v", shared)
	}
	if !hasJSONArray(shared, "attachments") {
		t.Fatalf("shared DTO should expose an attachments array: %+v", shared)
	}
	if html, _ := shared["html_content"].(string); strings.Contains(html, "<script") {
		t.Fatalf("shared html_content was not sanitized: %s", html)
	}

	webhook := mustJSONMap(t, webhookMessagePayloadDTO(msg, nil))
	if !hasJSONArray(webhook, "attachments") {
		t.Fatalf("webhook DTO should expose an attachments array: %+v", webhook)
	}
	if webhook["headers_json"] != `{"x-test":"yes"}` {
		t.Fatalf("webhook headers_json = %v", webhook["headers_json"])
	}
	if html, _ := webhook["html_content"].(string); strings.Contains(html, "<script") {
		t.Fatalf("webhook html_content was not sanitized: %s", html)
	}
}

func TestMessageDTOHelpersExposeAttachmentMetadata(t *testing.T) {
	now := time.Date(2026, 5, 20, 10, 45, 0, 0, time.UTC)
	msg := models.Message{
		ID:          "message-with-attachment",
		Recipient:   "demo@example.test",
		FromAddress: "sender@example.com",
		Subject:     "Subject",
		CreatedAt:   now,
		ExpiresAt:   now.Add(time.Hour),
	}
	attachment := attachmentMetadataDTO(models.MessageAttachment{
		ID:               "attachment-1",
		MessageID:        msg.ID,
		Sequence:         1,
		Filename:         "note.txt",
		ContentType:      "text/plain",
		Disposition:      "attachment",
		TransferEncoding: "base64",
		SizeBytes:        5,
		SHA256:           strings.Repeat("a", 64),
		CreatedAt:        now,
	})

	summary := mustJSONMap(t, messageSummaryDTO(msg, 1))
	if summary["attachment_count"] != float64(1) {
		t.Fatalf("summary attachment_count = %v", summary["attachment_count"])
	}

	detail := mustJSONMap(t, publicMessageDetail(msg, []AttachmentMetadata{attachment}))
	if detail["attachment_count"] != float64(1) {
		t.Fatalf("detail attachment_count = %v", detail["attachment_count"])
	}
	rawAttachments, ok := detail["attachments"].([]any)
	if !ok || len(rawAttachments) != 1 {
		t.Fatalf("detail attachments = %#v", detail["attachments"])
	}
	first, ok := rawAttachments[0].(map[string]any)
	if !ok || first["filename"] != "note.txt" || first["message_id"] != msg.ID {
		t.Fatalf("unexpected attachment json: %#v", rawAttachments[0])
	}
}

func mustJSONMap(t *testing.T, value any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func assertJSONKeys(t *testing.T, got map[string]any, keys ...string) {
	t.Helper()
	if len(got) != len(keys) {
		t.Fatalf("keys = %v, want %v", sortedKeys(got), keys)
	}
	for _, key := range keys {
		if _, ok := got[key]; !ok {
			t.Fatalf("missing key %q in %v", key, sortedKeys(got))
		}
	}
}

func hasJSONArray(values map[string]any, key string) bool {
	value, ok := values[key]
	if !ok {
		return false
	}
	_, ok = value.([]any)
	return ok
}

func sortedKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
	return keys
}

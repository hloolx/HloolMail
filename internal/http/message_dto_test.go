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
		HTMLContent: `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width: 600px; max-width: 100%; margin: 0 auto; border-collapse: collapse; background-color: #ffffff"><tbody><tr><td align="center" bgcolor="#f7f7f7" style="padding: 16px 24px; color: #333333; font-family: Arial, sans-serif; text-align: center; line-height: 1.5"><script>alert("x")</script><a href="javascript:alert(1)" onclick="alert(1)" style="color: #2563eb; text-decoration: underline; background-image: url(javascript:alert(1))">hello</a><form action="/x"><input name="code"></form></td></tr></tbody></table>`,
		HeadersJSON: `{"x-test":"yes"}`,
		CreatedAt:   now,
		ExpiresAt:   now.Add(time.Hour),
	}

	shared := mustJSONMap(t, publicSharedMailboxMessageDTO(msg, nil))
	if _, ok := shared["headers_json"]; ok {
		t.Fatalf("shared DTO must not expose headers_json: %+v", shared)
	}
	if !hasJSONArray(shared, "attachments") {
		t.Fatalf("shared DTO should expose an attachments array: %+v", shared)
	}
	assertMailHTMLSanitized(t, "shared", shared["html_content"].(string))

	webhook := mustJSONMap(t, webhookMessagePayloadDTO(msg, nil))
	if !hasJSONArray(webhook, "attachments") {
		t.Fatalf("webhook DTO should expose an attachments array: %+v", webhook)
	}
	if webhook["headers_json"] != `{"x-test":"yes"}` {
		t.Fatalf("webhook headers_json = %v", webhook["headers_json"])
	}
	assertMailHTMLSanitized(t, "webhook", webhook["html_content"].(string))
}

func assertMailHTMLSanitized(t *testing.T, label, html string) {
	t.Helper()
	for _, blocked := range []string{"<script", "onclick", "javascript:", "<form", "<input", "background-image"} {
		if strings.Contains(strings.ToLower(html), blocked) {
			t.Fatalf("%s html_content kept blocked content %q: %s", label, blocked, html)
		}
	}
	for _, want := range []string{
		"<table",
		"<tbody",
		"<tr",
		"<td",
		`role="presentation"`,
		`cellpadding="0"`,
		`cellspacing="0"`,
		`align="center"`,
		`bgcolor="#f7f7f7"`,
		"style=",
		"width: 600px",
		"max-width: 100%",
		"margin: 0 auto",
		"border-collapse: collapse",
		"background-color: #ffffff",
		"padding: 16px 24px",
		"color: #333333",
		"font-family: Arial, sans-serif",
		"text-align: center",
		"line-height: 1.5",
		"color: #2563eb",
		"text-decoration: underline",
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("%s html_content missing %q: %s", label, want, html)
		}
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

func TestMessageSummaryDTOIncludesVerificationCode(t *testing.T) {
	now := time.Date(2026, 5, 20, 11, 0, 0, 0, time.UTC)
	msg := models.Message{
		ID:          "message-code",
		Recipient:   "demo@example.test",
		FromAddress: "noreply@openai.com",
		Subject:     "Your OpenAI verification code",
		TextContent: "Use 123-456 to finish signing in. This code expires soon.",
		HTMLContent: "<p>Order 998877</p>",
		CreatedAt:   now,
		ExpiresAt:   now.Add(time.Hour),
	}

	summary := mustJSONMap(t, messageSummaryDTO(msg))
	if summary["verification_code"] != "123456" {
		t.Fatalf("summary verification_code = %v", summary["verification_code"])
	}

	detail := mustJSONMap(t, publicMessageDetail(msg))
	if detail["verification_code"] != "123456" {
		t.Fatalf("detail verification_code = %v", detail["verification_code"])
	}
}

func TestMessageSummaryDTOOmitsVerificationFalsePositive(t *testing.T) {
	now := time.Date(2026, 5, 20, 11, 10, 0, 0, time.UTC)
	msg := models.Message{
		ID:          "message-order",
		Recipient:   "demo@example.test",
		FromAddress: "shop@example.com",
		Subject:     "Order 20260520 shipped",
		TextContent: "Your tracking number is 123456789 and the total is 1299.",
		CreatedAt:   now,
		ExpiresAt:   now.Add(time.Hour),
	}

	summary := mustJSONMap(t, messageSummaryDTO(msg))
	if _, ok := summary["verification_code"]; ok {
		t.Fatalf("summary should omit verification_code for order-like mail: %+v", summary)
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

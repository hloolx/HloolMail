package mailparser

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
)

func TestParseMultipartMessage(t *testing.T) {
	raw := []byte("From: Sender <sender@test.local>\r\n" +
		"To: demo@example.test\r\n" +
		"Subject: Code 123456\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: multipart/mixed; boundary=outer\r\n\r\n" +
		"--outer\r\n" +
		"Content-Type: text/plain; charset=utf-8\r\n\r\n" +
		"Your code is 123456\r\n" +
		"--outer\r\n" +
		"Content-Type: text/html; charset=utf-8\r\n\r\n" +
		"<strong>Your code is 123456</strong>\r\n" +
		"--outer\r\n" +
		"Content-Type: text/plain; name=note.txt\r\n" +
		"Content-Disposition: attachment; filename=note.txt\r\n" +
		"Content-Transfer-Encoding: base64\r\n\r\n" +
		"aGVsbG8=\r\n" +
		"--outer--\r\n")

	parsed, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.FromAddress != "sender@test.local" {
		t.Fatalf("from = %q", parsed.FromAddress)
	}
	if parsed.Subject != "Code 123456" {
		t.Fatalf("subject = %q", parsed.Subject)
	}
	if strings.TrimSpace(parsed.Text) != "Your code is 123456" {
		t.Fatalf("text = %q", parsed.Text)
	}
	if strings.Contains(parsed.Text, "hello") || strings.Contains(parsed.HTML, "hello") {
		t.Fatalf("attachment body leaked into parsed content: text=%q html=%q", parsed.Text, parsed.HTML)
	}
	if len(parsed.Attachments) != 1 {
		t.Fatalf("attachments = %d, want 1", len(parsed.Attachments))
	}
	attachment := parsed.Attachments[0]
	if attachment.Sequence != 1 || attachment.Filename != "note.txt" || attachment.ContentType != "text/plain" || attachment.Disposition != "attachment" || attachment.TransferEncoding != "base64" {
		t.Fatalf("unexpected attachment metadata: %+v", attachment)
	}
	if attachment.SizeBytes != 5 {
		t.Fatalf("attachment size = %d, want 5", attachment.SizeBytes)
	}
	wantHash := sha256.Sum256([]byte("hello"))
	if attachment.SHA256 != hex.EncodeToString(wantHash[:]) {
		t.Fatalf("attachment sha256 = %q", attachment.SHA256)
	}
}

func TestParseCapturesInlineAttachmentMetadata(t *testing.T) {
	raw := []byte("From: Sender <sender@test.local>\r\n" +
		"To: demo@example.test\r\n" +
		"Subject: Inline image\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: multipart/related; boundary=outer\r\n\r\n" +
		"--outer\r\n" +
		"Content-Type: text/html; charset=utf-8\r\n\r\n" +
		"<img src=\"cid:logo-1\">\r\n" +
		"--outer\r\n" +
		"Content-Type: image/png; name=logo.png\r\n" +
		"Content-Disposition: inline; filename=logo.png\r\n" +
		"Content-ID: <logo-1>\r\n" +
		"Content-Transfer-Encoding: base64\r\n\r\n" +
		"aW1n\r\n" +
		"--outer--\r\n")

	parsed, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.Attachments) != 1 {
		t.Fatalf("attachments = %d, want 1", len(parsed.Attachments))
	}
	attachment := parsed.Attachments[0]
	if !attachment.Inline || attachment.ContentID != "logo-1" || attachment.Filename != "logo.png" {
		t.Fatalf("unexpected inline attachment metadata: %+v", attachment)
	}
	if attachment.SizeBytes != 3 {
		t.Fatalf("attachment size = %d, want 3", attachment.SizeBytes)
	}
}

func TestParseWithOptionsRejectsOversizedAttachment(t *testing.T) {
	raw := []byte("From: Sender <sender@test.local>\r\n" +
		"To: demo@example.test\r\n" +
		"Subject: Large attachment\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: multipart/mixed; boundary=outer\r\n\r\n" +
		"--outer\r\n" +
		"Content-Type: text/plain; charset=utf-8\r\n\r\n" +
		"hello\r\n" +
		"--outer\r\n" +
		"Content-Type: application/octet-stream; name=file.bin\r\n" +
		"Content-Disposition: attachment; filename=file.bin\r\n\r\n" +
		"123456\r\n" +
		"--outer--\r\n")

	_, err := ParseWithOptions(raw, ParseOptions{MaxAttachmentBytes: 5})
	if !errors.Is(err, ErrAttachmentTooLarge) {
		t.Fatalf("error = %v, want ErrAttachmentTooLarge", err)
	}
}

func TestParseWithOptionsLimitsUnnamedBinaryParts(t *testing.T) {
	raw := []byte("From: Sender <sender@test.local>\r\n" +
		"To: demo@example.test\r\n" +
		"Subject: Inline binary\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: multipart/mixed; boundary=outer\r\n\r\n" +
		"--outer\r\n" +
		"Content-Type: text/plain; charset=utf-8\r\n\r\n" +
		"hello\r\n" +
		"--outer\r\n" +
		"Content-Type: application/octet-stream\r\n\r\n" +
		"123456\r\n" +
		"--outer--\r\n")

	_, err := ParseWithOptions(raw, ParseOptions{MaxAttachmentBytes: 5})
	if !errors.Is(err, ErrAttachmentTooLarge) {
		t.Fatalf("error = %v, want ErrAttachmentTooLarge", err)
	}
}

func TestParseTextCharsets(t *testing.T) {
	tests := []struct {
		name             string
		contentType      string
		transferEncoding string
		body             string
		want             string
	}{
		{
			name:             "iso-8859-1 quoted printable",
			contentType:      "text/plain; charset=iso-8859-1",
			transferEncoding: "quoted-printable",
			body:             "Caf=E9",
			want:             "Caf\u00e9",
		},
		{
			name:             "gb2312 base64",
			contentType:      "text/plain; charset=gb2312",
			transferEncoding: "base64",
			body:             "1tDOxA==",
			want:             "\u4e2d\u6587",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw := []byte("From: Sender <sender@test.local>\r\n" +
				"To: demo@example.test\r\n" +
				"Subject: Charset check\r\n" +
				"MIME-Version: 1.0\r\n" +
				"Content-Type: " + tt.contentType + "\r\n" +
				"Content-Transfer-Encoding: " + tt.transferEncoding + "\r\n\r\n" +
				tt.body + "\r\n")

			parsed, err := Parse(raw)
			if err != nil {
				t.Fatal(err)
			}
			if strings.TrimSpace(parsed.Text) != tt.want {
				t.Fatalf("text = %q, want %q", parsed.Text, tt.want)
			}
		})
	}
}

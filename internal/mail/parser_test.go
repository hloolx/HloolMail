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

func TestParseWithOptionsRejectsTooManyAttachments(t *testing.T) {
	var raw strings.Builder
	raw.WriteString("From: Sender <sender@test.local>\r\n" +
		"To: demo@example.test\r\n" +
		"Subject: Many empty attachments\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: multipart/mixed; boundary=outer\r\n\r\n")
	for i := 0; i < 3; i++ {
		raw.WriteString("--outer\r\n" +
			"Content-Type: application/octet-stream; name=file.bin\r\n" +
			"Content-Disposition: attachment; filename=file.bin\r\n\r\n")
	}
	raw.WriteString("--outer--\r\n")

	_, err := ParseWithOptions([]byte(raw.String()), ParseOptions{MaxAttachments: 2})
	if !errors.Is(err, ErrTooManyAttachments) {
		t.Fatalf("error = %v, want ErrTooManyAttachments", err)
	}
}

func TestParseWithOptionsRejectsTooManyMIMEParts(t *testing.T) {
	raw := []byte("From: Sender <sender@test.local>\r\n" +
		"To: demo@example.test\r\n" +
		"Subject: Too many parts\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: multipart/mixed; boundary=outer\r\n\r\n" +
		"--outer\r\n" +
		"Content-Type: text/plain; charset=utf-8\r\n\r\n" +
		"one\r\n" +
		"--outer\r\n" +
		"Content-Type: text/plain; charset=utf-8\r\n\r\n" +
		"two\r\n" +
		"--outer--\r\n")

	_, err := ParseWithOptions(raw, ParseOptions{MaxMIMEParts: 1})
	if !errors.Is(err, ErrTooManyMIMEParts) {
		t.Fatalf("error = %v, want ErrTooManyMIMEParts", err)
	}
}

func TestParseMIMEBoundaryCases(t *testing.T) {
	tests := []struct {
		name             string
		raw              string
		wantText         string
		wantHTML         string
		wantAttachments  int
		wantErrSubstring string
	}{
		{
			name: "nested alternative in mixed message",
			raw: "From: Sender <sender@test.local>\r\n" +
				"To: demo@example.test\r\n" +
				"Subject: Nested boundaries\r\n" +
				"MIME-Version: 1.0\r\n" +
				"Content-Type: multipart/mixed; boundary=mix\r\n\r\n" +
				"ignored preamble\r\n" +
				"--mix\r\n" +
				"Content-Type: multipart/alternative; boundary=alt\r\n\r\n" +
				"--alt\r\n" +
				"Content-Type: text/plain; charset=utf-8\r\n" +
				"Content-Transfer-Encoding: quoted-printable\r\n\r\n" +
				"Plain body=0A--mix is only text here\r\n" +
				"--alt\r\n" +
				"Content-Type: text/html; charset=utf-8\r\n" +
				"Content-Transfer-Encoding: base64\r\n\r\n" +
				"PHA+SFRNTCBib2R5PC9wPg==\r\n" +
				"--alt--\r\n" +
				"--mix\r\n" +
				"Content-Type: application/octet-stream; name=file.bin\r\n" +
				"Content-Disposition: attachment; filename=file.bin\r\n\r\n" +
				"binary-data\r\n" +
				"--mix--\r\n" +
				"ignored epilogue\r\n",
			wantText:        "Plain body\n--mix is only text here",
			wantHTML:        "<p>HTML body</p>",
			wantAttachments: 1,
		},
		{
			name: "quoted boundary with punctuation",
			raw: "From: Sender <sender@test.local>\r\n" +
				"To: demo@example.test\r\n" +
				"Subject: Quoted boundary\r\n" +
				"MIME-Version: 1.0\r\n" +
				"Content-Type: multipart/alternative; boundary=\"=_weird.boundary+123\"\r\n\r\n" +
				"--=_weird.boundary+123\r\n" +
				"Content-Type: text/plain; charset=utf-8\r\n\r\n" +
				"quoted boundary text\r\n" +
				"--=_weird.boundary+123\r\n" +
				"Content-Type: text/html; charset=utf-8\r\n\r\n" +
				"<p>quoted boundary html</p>\r\n" +
				"--=_weird.boundary+123--\r\n",
			wantText: "quoted boundary text",
			wantHTML: "<p>quoted boundary html</p>",
		},
		{
			name: "lookalike boundary remains in text body",
			raw: "From: Sender <sender@test.local>\r\n" +
				"To: demo@example.test\r\n" +
				"Subject: Boundary-like text\r\n" +
				"MIME-Version: 1.0\r\n" +
				"Content-Type: multipart/mixed; boundary=real-boundary\r\n\r\n" +
				"--real-boundary\r\n" +
				"Content-Type: text/plain; charset=utf-8\r\n\r\n" +
				"first line\r\n--fake-boundary\r\ninline --real-boundary marker is text\r\nlast line\r\n" +
				"--real-boundary--\r\n",
			wantText: "first line\r\n--fake-boundary\r\ninline --real-boundary marker is text\r\nlast line",
		},
		{
			name: "multipart without boundary is ignored",
			raw: "From: Sender <sender@test.local>\r\n" +
				"To: demo@example.test\r\n" +
				"Subject: Missing boundary\r\n" +
				"MIME-Version: 1.0\r\n" +
				"Content-Type: multipart/mixed\r\n\r\n" +
				"this body cannot be split without a boundary\r\n",
		},
		{
			name: "truncated multipart reports parse error",
			raw: "From: Sender <sender@test.local>\r\n" +
				"To: demo@example.test\r\n" +
				"Subject: Truncated boundary\r\n" +
				"MIME-Version: 1.0\r\n" +
				"Content-Type: multipart/mixed; boundary=outer\r\n\r\n" +
				"--outer\r\n" +
				"Content-Type: text/plain; charset=utf-8\r\n\r\n" +
				"body without a closing boundary",
			wantErrSubstring: "unexpected EOF",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			parsed, err := Parse([]byte(tt.raw))
			if tt.wantErrSubstring != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErrSubstring) {
					t.Fatalf("error = %v, want substring %q", err, tt.wantErrSubstring)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if strings.TrimSpace(parsed.Text) != tt.wantText {
				t.Fatalf("text = %q, want %q", parsed.Text, tt.wantText)
			}
			if strings.TrimSpace(parsed.HTML) != tt.wantHTML {
				t.Fatalf("html = %q, want %q", parsed.HTML, tt.wantHTML)
			}
			if len(parsed.Attachments) != tt.wantAttachments {
				t.Fatalf("attachments = %d, want %d", len(parsed.Attachments), tt.wantAttachments)
			}
		})
	}
}

func TestParseWithOptionsRejectsOversizedTextBody(t *testing.T) {
	raw := []byte("From: Sender <sender@test.local>\r\n" +
		"To: demo@example.test\r\n" +
		"Subject: Large text\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: text/html; charset=utf-8\r\n\r\n" +
		"123456\r\n")

	_, err := ParseWithOptions(raw, ParseOptions{MaxBodyBytes: 5})
	if !errors.Is(err, ErrBodyTooLarge) {
		t.Fatalf("error = %v, want ErrBodyTooLarge", err)
	}
}

func TestParseTruncatesLongAttachmentMetadata(t *testing.T) {
	longFilename := strings.Repeat("f", 700)
	longContentID := strings.Repeat("c", 300)
	raw := []byte("From: Sender <sender@test.local>\r\n" +
		"To: demo@example.test\r\n" +
		"Subject: Long metadata\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: multipart/mixed; boundary=outer\r\n\r\n" +
		"--outer\r\n" +
		"Content-Type: application/octet-stream; name=\"" + longFilename + "\"\r\n" +
		"Content-Disposition: attachment; filename=\"" + longFilename + "\"\r\n" +
		"Content-ID: <" + longContentID + ">\r\n\r\n" +
		"data\r\n" +
		"--outer--\r\n")

	parsed, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.Attachments) != 1 {
		t.Fatalf("attachments = %d, want 1", len(parsed.Attachments))
	}
	attachment := parsed.Attachments[0]
	if len([]rune(attachment.Filename)) != 500 {
		t.Fatalf("filename length = %d, want 500", len([]rune(attachment.Filename)))
	}
	if len([]rune(attachment.ContentID)) != 255 {
		t.Fatalf("content id length = %d, want 255", len([]rune(attachment.ContentID)))
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

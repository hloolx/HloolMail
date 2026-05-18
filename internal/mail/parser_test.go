package mailparser

import (
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

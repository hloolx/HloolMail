package mailparser

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"strings"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/htmlindex"
	"golang.org/x/text/encoding/ianaindex"
	"golang.org/x/text/transform"
)

var ErrAttachmentTooLarge = errors.New("attachment exceeds size limit")

type ParseOptions struct {
	MaxAttachmentBytes int64
}

type ParsedMessage struct {
	FromAddress string
	FromName    string
	Subject     string
	Text        string
	HTML        string
	HeadersJSON string
	Attachments []ParsedAttachment
}

type ParsedAttachment struct {
	Sequence         int
	Filename         string
	ContentType      string
	Disposition      string
	ContentID        string
	TransferEncoding string
	SizeBytes        int64
	SHA256           string
	Inline           bool
}

func Parse(raw []byte) (ParsedMessage, error) {
	return ParseWithOptions(raw, ParseOptions{})
}

func ParseWithOptions(raw []byte, options ParseOptions) (ParsedMessage, error) {
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		return ParsedMessage{}, err
	}
	parsed := ParsedMessage{
		Subject: decodeHeader(msg.Header.Get("Subject")),
	}
	if from := msg.Header.Get("From"); from != "" {
		if addr, err := mail.ParseAddress(from); err == nil {
			parsed.FromAddress = strings.ToLower(addr.Address)
			parsed.FromName = decodeHeader(addr.Name)
		} else {
			parsed.FromAddress = from
		}
	}
	headers := map[string][]string(msg.Header)
	if payload, err := json.Marshal(headers); err == nil {
		parsed.HeadersJSON = string(payload)
	}
	if err := parseEntity(msg.Header, msg.Body, &parsed, options, 0); err != nil {
		return parsed, err
	}
	return parsed, nil
}

func parseEntity(header mail.Header, body io.Reader, parsed *ParsedMessage, options ParseOptions, depth int) error {
	if depth > 32 {
		return fmt.Errorf("mime recursion depth exceeded")
	}
	contentType := header.Get("Content-Type")
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil || mediaType == "" {
		mediaType = "text/plain"
	}
	if strings.HasPrefix(strings.ToLower(mediaType), "multipart/") {
		boundary := params["boundary"]
		if boundary == "" {
			return nil
		}
		reader := multipart.NewReader(body, boundary)
		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				return nil
			}
			if err != nil {
				return err
			}
			partHeader := mail.Header(part.Header)
			if err := parseEntity(partHeader, part, parsed, options, depth+1); err != nil {
				return err
			}
		}
	}

	disposition, dispositionParams, _ := mime.ParseMediaType(header.Get("Content-Disposition"))
	filename := decodeHeader(dispositionParams["filename"])
	if filename == "" {
		_, params, _ := mime.ParseMediaType(header.Get("Content-Type"))
		filename = decodeHeader(params["name"])
	}
	lowerMediaType := strings.ToLower(mediaType)
	isAttachment := strings.EqualFold(disposition, "attachment") || filename != ""
	isTextPart := lowerMediaType == "text/plain" || lowerMediaType == "text/html"
	if isAttachment || !isTextPart {
		stats, err := discardAttachment(header, body, options.MaxAttachmentBytes)
		if err != nil {
			return err
		}
		parsed.Attachments = append(parsed.Attachments, ParsedAttachment{
			Sequence:         len(parsed.Attachments) + 1,
			Filename:         filename,
			ContentType:      lowerMediaType,
			Disposition:      strings.ToLower(strings.TrimSpace(disposition)),
			ContentID:        contentID(header),
			TransferEncoding: transferEncoding(header),
			SizeBytes:        stats.SizeBytes,
			SHA256:           stats.SHA256,
			Inline:           strings.EqualFold(disposition, "inline"),
		})
		return nil
	}

	data, err := readDecoded(header, body)
	if err != nil {
		return err
	}
	text, err := decodeText(data, params["charset"])
	if err != nil {
		return err
	}
	switch lowerMediaType {
	case "text/plain":
		parsed.Text += text
	case "text/html":
		parsed.HTML += text
	}
	return nil
}

type attachmentStats struct {
	SizeBytes int64
	SHA256    string
}

func discardAttachment(header mail.Header, body io.Reader, max int64) (attachmentStats, error) {
	reader := transferDecoder(header, body)
	hasher := sha256.New()
	var n int64
	var err error
	if max <= 0 {
		n, err = io.Copy(hasher, reader)
		if err != nil {
			return attachmentStats{}, err
		}
		return attachmentStats{SizeBytes: n, SHA256: hex.EncodeToString(hasher.Sum(nil))}, nil
	}
	n, err = io.Copy(hasher, io.LimitReader(reader, max+1))
	if err != nil {
		return attachmentStats{}, err
	}
	if n > max {
		return attachmentStats{}, fmt.Errorf("%w: maximum %d bytes", ErrAttachmentTooLarge, max)
	}
	return attachmentStats{SizeBytes: n, SHA256: hex.EncodeToString(hasher.Sum(nil))}, nil
}

func readDecoded(header mail.Header, body io.Reader) ([]byte, error) {
	return io.ReadAll(transferDecoder(header, body))
}

func transferDecoder(header mail.Header, body io.Reader) io.Reader {
	switch transferEncoding(header) {
	case "base64":
		return base64.NewDecoder(base64.StdEncoding, body)
	case "quoted-printable":
		return quotedprintable.NewReader(body)
	default:
		return body
	}
}

func transferEncoding(header mail.Header) string {
	return strings.ToLower(strings.TrimSpace(header.Get("Content-Transfer-Encoding")))
}

func contentID(header mail.Header) string {
	return strings.Trim(strings.TrimSpace(header.Get("Content-ID")), "<>")
}

func decodeText(data []byte, charset string) (string, error) {
	charset = strings.TrimSpace(charset)
	if charset == "" {
		return string(data), nil
	}
	enc, err := lookupCharset(charset)
	if err != nil {
		return string(data), nil
	}
	decoded, _, err := transform.Bytes(enc.NewDecoder(), data)
	if err != nil {
		return "", err
	}
	return string(decoded), nil
}

func lookupCharset(charset string) (encoding.Encoding, error) {
	if enc, err := ianaindex.MIME.Encoding(charset); err == nil && enc != nil {
		return enc, nil
	}
	return htmlindex.Get(charset)
}

func decodeHeader(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	decoded, err := new(mime.WordDecoder).DecodeHeader(value)
	if err != nil {
		return value
	}
	return decoded
}

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
	"unicode/utf8"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/htmlindex"
	"golang.org/x/text/encoding/ianaindex"
	"golang.org/x/text/transform"
)

var (
	ErrAttachmentTooLarge = errors.New("attachment exceeds size limit")
	ErrBodyTooLarge       = errors.New("message body exceeds size limit")
	ErrTooManyAttachments = errors.New("message has too many attachments")
	ErrTooManyMIMEParts   = errors.New("message has too many MIME parts")
)

const (
	defaultMaxAttachmentCount = 100
	defaultMaxMIMEPartCount   = 200
	defaultMaxBodyBytes       = 2 * 1024 * 1024

	maxAttachmentFilenameLength         = 500
	maxAttachmentContentTypeLength      = 255
	maxAttachmentDispositionLength      = 40
	maxAttachmentContentIDLength        = 255
	maxAttachmentTransferEncodingLength = 40
)

type ParseOptions struct {
	MaxAttachmentBytes int64
	MaxAttachments     int
	MaxMIMEParts       int
	MaxBodyBytes       int64
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
	state := newParseState(options)
	if err := parseEntity(msg.Header, msg.Body, &parsed, state, 0); err != nil {
		return parsed, err
	}
	return parsed, nil
}

type parseState struct {
	options         ParseOptions
	partCount       int
	attachmentCount int
}

func newParseState(options ParseOptions) *parseState {
	if options.MaxAttachments <= 0 {
		options.MaxAttachments = defaultMaxAttachmentCount
	}
	if options.MaxMIMEParts <= 0 {
		options.MaxMIMEParts = defaultMaxMIMEPartCount
	}
	if options.MaxBodyBytes <= 0 {
		options.MaxBodyBytes = defaultMaxBodyBytes
	}
	return &parseState{options: options}
}

func (s *parseState) countPart() error {
	s.partCount++
	if s.partCount > s.options.MaxMIMEParts {
		return fmt.Errorf("%w: maximum %d parts", ErrTooManyMIMEParts, s.options.MaxMIMEParts)
	}
	return nil
}

func (s *parseState) countAttachment() error {
	s.attachmentCount++
	if s.attachmentCount > s.options.MaxAttachments {
		return fmt.Errorf("%w: maximum %d attachments", ErrTooManyAttachments, s.options.MaxAttachments)
	}
	return nil
}

func parseEntity(header mail.Header, body io.Reader, parsed *ParsedMessage, state *parseState, depth int) error {
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
			if err := state.countPart(); err != nil {
				return err
			}
			partHeader := mail.Header(part.Header)
			if err := parseEntity(partHeader, part, parsed, state, depth+1); err != nil {
				return err
			}
		}
	}

	disposition, dispositionParams, _ := mime.ParseMediaType(header.Get("Content-Disposition"))
	disposition = truncateString(strings.ToLower(strings.TrimSpace(disposition)), maxAttachmentDispositionLength)
	filename := truncateString(decodeHeader(dispositionParams["filename"]), maxAttachmentFilenameLength)
	if filename == "" {
		_, params, _ := mime.ParseMediaType(header.Get("Content-Type"))
		filename = truncateString(decodeHeader(params["name"]), maxAttachmentFilenameLength)
	}
	lowerMediaType := truncateString(strings.ToLower(mediaType), maxAttachmentContentTypeLength)
	isAttachment := strings.EqualFold(disposition, "attachment") || filename != ""
	isTextPart := lowerMediaType == "text/plain" || lowerMediaType == "text/html"
	if isAttachment || !isTextPart {
		if err := state.countAttachment(); err != nil {
			return err
		}
		stats, err := discardAttachment(header, body, state.options.MaxAttachmentBytes)
		if err != nil {
			return err
		}
		parsed.Attachments = append(parsed.Attachments, ParsedAttachment{
			Sequence:         len(parsed.Attachments) + 1,
			Filename:         filename,
			ContentType:      lowerMediaType,
			Disposition:      disposition,
			ContentID:        truncateString(contentID(header), maxAttachmentContentIDLength),
			TransferEncoding: truncateString(transferEncoding(header), maxAttachmentTransferEncodingLength),
			SizeBytes:        stats.SizeBytes,
			SHA256:           stats.SHA256,
			Inline:           strings.EqualFold(disposition, "inline"),
		})
		return nil
	}

	data, err := readDecoded(header, body, state.options.MaxBodyBytes)
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

func readDecoded(header mail.Header, body io.Reader, max int64) ([]byte, error) {
	reader := transferDecoder(header, body)
	if max <= 0 {
		return io.ReadAll(reader)
	}
	data, err := io.ReadAll(io.LimitReader(reader, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > max {
		return nil, fmt.Errorf("%w: maximum %d bytes", ErrBodyTooLarge, max)
	}
	return data, nil
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

func truncateString(value string, maxRunes int) string {
	if maxRunes <= 0 || value == "" {
		return value
	}
	if utf8.RuneCountInString(value) <= maxRunes {
		return value
	}
	runes := []rune(value)
	return string(runes[:maxRunes])
}

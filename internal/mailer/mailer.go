package mailer

import (
	"bufio"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/mail"
	"net/smtp"
	"sort"
	"strings"
	"time"
)

type stageRecorderKey struct{}

type StageRecorder func(stage, detail string)

func WithStageRecorder(ctx context.Context, recorder StageRecorder) context.Context {
	if recorder == nil {
		return ctx
	}
	return context.WithValue(ctx, stageRecorderKey{}, recorder)
}

func recordStage(ctx context.Context, stage, detail string) {
	recorder, _ := ctx.Value(stageRecorderKey{}).(StageRecorder)
	if recorder != nil {
		recorder(stage, detail)
	}
}

type Message struct {
	To      string
	Subject string
	Text    string
	HTML    string
}

type Settings struct {
	Mode                 string
	MailHostname         string
	InternalSenderPrefix string
	SMTPHost             string
	SMTPPort             int
	SMTPSecurity         string
	SMTPUsername         string
	SMTPPassword         string
	SMTPFromName         string
	SMTPFromEmail        string
}

type Sender interface {
	Send(ctx context.Context, settings Settings, message Message) error
}

type DefaultSender struct{}

func (DefaultSender) Send(ctx context.Context, settings Settings, message Message) error {
	switch strings.ToLower(strings.TrimSpace(settings.Mode)) {
	case "", "internal":
		return sendInternal(ctx, settings, message)
	case "smtp":
		return sendSMTP(ctx, settings, message)
	default:
		return fmt.Errorf("unsupported email verification mode %q", settings.Mode)
	}
}

func sendInternal(ctx context.Context, settings Settings, message Message) error {
	host := normalizeHost(settings.MailHostname)
	if host == "" {
		return fmt.Errorf("mail hostname is required for internal delivery")
	}
	from := strings.ToLower(strings.TrimSpace(settings.InternalSenderPrefix))
	if from == "" {
		from = "no-reply"
	}
	from = sanitizeLocalPart(from) + "@" + rootDomain(host)

	recipientDomain := domainFromEmail(message.To)
	if recipientDomain == "" {
		return fmt.Errorf("valid recipient email is required")
	}
	recordStage(ctx, "dns_mx", "looking up MX records for "+recipientDomain)
	mxs, err := net.DefaultResolver.LookupMX(ctx, recipientDomain)
	if err != nil {
		return fmt.Errorf("lookup MX for %s: %w", recipientDomain, err)
	}
	if len(mxs) == 0 {
		return fmt.Errorf("no MX records found for %s", recipientDomain)
	}
	sort.Slice(mxs, func(i, j int) bool {
		return mxs[i].Pref < mxs[j].Pref
	})

	var lastErr error
	for _, mx := range mxs {
		mxHost := strings.TrimSuffix(mx.Host, ".")
		addr := net.JoinHostPort(mxHost, "25")
		dialer := net.Dialer{Timeout: 15 * time.Second}
		recordStage(ctx, "connect", "connecting to "+addr)
		conn, err := dialer.DialContext(ctx, "tcp", addr)
		if err != nil {
			lastErr = fmt.Errorf("connect %s: %w", addr, err)
			continue
		}
		_ = conn.SetDeadline(time.Now().Add(45 * time.Second))
		err = deliverSMTP(ctx, conn, host, from, message)
		if err == nil {
			return nil
		}
		lastErr = fmt.Errorf("deliver via %s: %w", mxHost, err)
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no usable MX records for %s", recipientDomain)
	}
	return lastErr
}

func sendSMTP(ctx context.Context, settings Settings, message Message) error {
	host := normalizeHost(settings.SMTPHost)
	if host == "" {
		return fmt.Errorf("smtp_host is required")
	}
	security := strings.ToLower(strings.TrimSpace(settings.SMTPSecurity))
	if security == "" {
		security = "starttls"
	}
	switch security {
	case "none", "starttls", "tls":
	default:
		return fmt.Errorf("smtp_security must be none, starttls, or tls")
	}
	port := settings.SMTPPort
	if port == 0 {
		if security == "tls" {
			port = 465
		} else {
			port = 587
		}
	}
	from := strings.TrimSpace(settings.SMTPFromEmail)
	if from == "" {
		return fmt.Errorf("smtp_from_email is required")
	}
	if err := validateAddress(from); err != nil {
		return fmt.Errorf("smtp_from_email: %w", err)
	}
	addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))

	var conn net.Conn
	var err error
	dialer := net.Dialer{Timeout: 15 * time.Second}
	recordStage(ctx, "connect", "connecting to SMTP "+addr)
	if security == "tls" {
		tlsDialer := tls.Dialer{NetDialer: &dialer, Config: &tls.Config{ServerName: host}}
		conn, err = tlsDialer.DialContext(ctx, "tcp", addr)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return fmt.Errorf("connect SMTP %s: %w", addr, err)
	}
	_ = conn.SetDeadline(time.Now().Add(45 * time.Second))
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		_ = conn.Close()
		return err
	}
	defer client.Close()

	helo := normalizeHost(settings.MailHostname)
	if helo == "" {
		helo = "localhost"
	}
	recordStage(ctx, "ehlo", "sending EHLO "+helo)
	if err := client.Hello(helo); err != nil {
		return err
	}
	if security == "starttls" {
		recordStage(ctx, "starttls", "checking STARTTLS support")
		ok, _ := client.Extension("STARTTLS")
		if !ok {
			return fmt.Errorf("SMTP server does not advertise STARTTLS")
		}
		if err := client.StartTLS(&tls.Config{ServerName: host}); err != nil {
			return err
		}
	}
	if settings.SMTPUsername != "" || settings.SMTPPassword != "" {
		recordStage(ctx, "auth", "authenticating SMTP user")
		if err := client.Auth(smtp.PlainAuth("", settings.SMTPUsername, settings.SMTPPassword, host)); err != nil {
			return err
		}
	}
	return finishSMTP(ctx, client, from, settings.SMTPFromName, message)
}

func deliverSMTP(ctx context.Context, conn net.Conn, helo, from string, message Message) error {
	client, err := smtp.NewClient(conn, strings.TrimSuffix(conn.RemoteAddr().String(), ":25"))
	if err != nil {
		_ = conn.Close()
		return err
	}
	defer client.Close()
	recordStage(ctx, "ehlo", "sending EHLO "+helo)
	if err := client.Hello(helo); err != nil {
		return err
	}
	return finishSMTP(ctx, client, from, "", message)
}

func finishSMTP(ctx context.Context, client *smtp.Client, from, fromName string, message Message) error {
	if err := validateAddress(from); err != nil {
		return fmt.Errorf("from address: %w", err)
	}
	to := strings.TrimSpace(message.To)
	if err := validateAddress(to); err != nil {
		return fmt.Errorf("recipient address: %w", err)
	}
	recordStage(ctx, "mail_from", "sending MAIL FROM")
	if err := client.Mail(from); err != nil {
		return err
	}
	recordStage(ctx, "rcpt_to", "sending RCPT TO "+to)
	if err := client.Rcpt(to); err != nil {
		return err
	}
	recordStage(ctx, "data", "sending message DATA")
	writer, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := io.WriteString(writer, renderMessage(from, fromName, message)); err != nil {
		_ = writer.Close()
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	recordStage(ctx, "quit", "closing SMTP session")
	return client.Quit()
}

func renderMessage(from, fromName string, message Message) string {
	fromName = sanitizeHeaderText(fromName)
	fromHeader := mail.Address{Name: fromName, Address: from}
	toHeader := mail.Address{Address: strings.TrimSpace(message.To)}
	fromAddress := fromHeader.String()
	toAddress := toHeader.String()
	var b strings.Builder
	headers := []string{
		"From: " + fromAddress,
		"To: " + toAddress,
		"Subject: " + sanitizeHeaderText(message.Subject),
		"Date: " + time.Now().Format(time.RFC1123Z),
		"MIME-Version: 1.0",
	}
	for _, header := range headers {
		b.WriteString(header)
		b.WriteString("\r\n")
	}
	if strings.TrimSpace(message.HTML) != "" {
		boundary := fmt.Sprintf("hloolmail-%d", time.Now().UnixNano())
		b.WriteString("Content-Type: multipart/alternative; boundary=")
		b.WriteString(boundary)
		b.WriteString("\r\n\r\n")
		writePart(&b, boundary, "text/plain; charset=utf-8", message.Text)
		writePart(&b, boundary, "text/html; charset=utf-8", message.HTML)
		b.WriteString("--")
		b.WriteString(boundary)
		b.WriteString("--\r\n")
		return b.String()
	}
	b.WriteString("Content-Type: text/plain; charset=utf-8\r\n\r\n")
	b.WriteString(normalizeCRLF(message.Text))
	return b.String()
}

func writePart(b *strings.Builder, boundary, contentType, body string) {
	b.WriteString("--")
	b.WriteString(boundary)
	b.WriteString("\r\nContent-Type: ")
	b.WriteString(contentType)
	b.WriteString("\r\n\r\n")
	b.WriteString(normalizeCRLF(body))
	b.WriteString("\r\n")
}

func normalizeCRLF(value string) string {
	var b strings.Builder
	scanner := bufio.NewScanner(strings.NewReader(value))
	for scanner.Scan() {
		b.WriteString(scanner.Text())
		b.WriteString("\r\n")
	}
	return b.String()
}

func normalizeHost(host string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
}

func domainFromEmail(email string) string {
	_, domain, ok := strings.Cut(strings.TrimSpace(email), "@")
	if !ok {
		return ""
	}
	return normalizeHost(domain)
}

func rootDomain(host string) string {
	parts := strings.Split(normalizeHost(host), ".")
	if len(parts) < 2 {
		return normalizeHost(host)
	}
	return strings.Join(parts[len(parts)-2:], ".")
}

func sanitizeLocalPart(value string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(value) {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '.', r == '-', r == '_':
			b.WriteRune(r)
		}
	}
	out := strings.Trim(b.String(), ".-_")
	if out == "" {
		return "no-reply"
	}
	return out
}

func validateAddress(value string) error {
	if strings.ContainsAny(value, "\r\n") {
		return fmt.Errorf("must not contain line breaks")
	}
	addr, err := mail.ParseAddress(strings.TrimSpace(value))
	if err != nil {
		return fmt.Errorf("must be a valid email address")
	}
	if addr.Address != strings.TrimSpace(value) {
		return fmt.Errorf("display names are not allowed here")
	}
	return nil
}

func sanitizeHeaderText(value string) string {
	value = strings.ReplaceAll(strings.TrimSpace(value), "\r", " ")
	value = strings.ReplaceAll(value, "\n", " ")
	return value
}

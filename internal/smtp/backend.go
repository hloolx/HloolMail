package smtpserver

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"gptmail/internal/domain"
	"gptmail/internal/events"
	mailparser "gptmail/internal/mail"
	"gptmail/internal/models"
	"gptmail/internal/webhook"

	gosmtp "github.com/emersion/go-smtp"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Backend struct {
	Service Service
}

type Session struct {
	service    Service
	from       string
	recipients []acceptedRecipient
}

type acceptedRecipient struct {
	Parts     domain.RecipientParts
	Domain    *models.Domain
	OwnerID   uint
	MailboxID *uint
}

func (b *Backend) NewSession(_ *gosmtp.Conn) (gosmtp.Session, error) {
	return &Session{service: b.Service}, nil
}

func (s *Session) AuthPlain(_, _ string) error {
	return nil
}

func (s *Session) Mail(from string, _ *gosmtp.MailOptions) error {
	s.from = strings.ToLower(strings.TrimSpace(from))
	s.recipients = nil
	return nil
}

func (s *Session) Rcpt(to string, _ *gosmtp.RcptOptions) error {
	parts, err := domain.NormalizeRecipient(to)
	if err != nil {
		return &gosmtp.SMTPError{Code: 550, Message: "invalid recipient"}
	}
	resolved, err := s.service.Resolver.ResolveDomain(parts.Recipient)
	if err != nil {
		return &gosmtp.SMTPError{Code: 550, Message: "unknown recipient domain"}
	}
	ownerID, mailboxID, err := s.resolveRecipientOwner(parts, resolved)
	if err != nil {
		return err
	}
	s.recipients = append(s.recipients, acceptedRecipient{
		Parts:     parts,
		Domain:    resolved,
		OwnerID:   ownerID,
		MailboxID: mailboxID,
	})
	return nil
}

func (s *Session) resolveRecipientOwner(parts domain.RecipientParts, resolved *models.Domain) (uint, *uint, error) {
	var mailbox models.Mailbox
	err := s.service.DB.Where("email = ?", parts.Recipient).First(&mailbox).Error
	if err == nil {
		mailboxID := mailbox.ID
		return mailbox.OwnerID, &mailboxID, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		slog.Warn("smtp failed to resolve recipient mailbox", "recipient", parts.Recipient, "error", err)
		return 0, nil, &gosmtp.SMTPError{Code: 451, Message: "failed to resolve recipient"}
	}
	if resolved.Mode == models.DomainModePublic {
		return 0, nil, &gosmtp.SMTPError{Code: 550, Message: "mailbox not found"}
	}
	if resolved.OwnerID == nil {
		return 0, nil, &gosmtp.SMTPError{Code: 550, Message: "recipient owner not found"}
	}
	return *resolved.OwnerID, nil, nil
}

func (s *Session) Data(r io.Reader) error {
	if len(s.recipients) == 0 {
		return &gosmtp.SMTPError{Code: 554, Message: "no valid recipients"}
	}
	raw, err := readLimited(r, s.service.Config.MaxMessageBytes)
	if err != nil {
		if errors.Is(err, errMessageTooLarge) {
			return &gosmtp.SMTPError{Code: 552, Message: "message exceeds size limit"}
		}
		slog.Warn("smtp failed to read message", "error", err)
		return &gosmtp.SMTPError{Code: 451, Message: "failed to read message"}
	}
	parsed, err := mailparser.ParseWithOptions(raw, mailparser.ParseOptions{
		MaxAttachmentBytes: maxAttachmentBytes(s.service.Config.MaxAttachmentBytes, s.service.Config.MaxMessageBytes),
	})
	if err != nil {
		if errors.Is(err, mailparser.ErrAttachmentTooLarge) {
			return &gosmtp.SMTPError{Code: 552, Message: "attachment exceeds size limit"}
		}
		slog.Warn("smtp failed to parse message", "error", err)
		return &gosmtp.SMTPError{Code: 554, Message: "failed to parse message"}
	}
	now := time.Now()
	for _, recipient := range s.recipients {
		messageID := uuid.NewString()
		msg := models.Message{
			ID:              messageID,
			Recipient:       recipient.Parts.Recipient,
			RecipientLocal:  recipient.Parts.Local,
			RecipientDomain: recipient.Parts.Host,
			RootDomain:      recipient.Domain.Domain,
			DomainID:        &recipient.Domain.ID,
			OwnerID:         &recipient.OwnerID,
			MailboxID:       recipient.MailboxID,
			FromAddress:     parsed.FromAddress,
			FromName:        parsed.FromName,
			Subject:         parsed.Subject,
			TextContent:     parsed.Text,
			HTMLContent:     parsed.HTML,
			HeadersJSON:     parsed.HeadersJSON,
			ExpiresAt:       now.Add(s.service.Config.MessageRetention),
		}
		if msg.FromAddress == "" {
			msg.FromAddress = s.from
		}
		if err := s.service.DB.Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(&msg).Error; err != nil {
				return err
			}
			if err := createMessageAttachments(tx, msg.ID, parsed.Attachments); err != nil {
				return err
			}
			return webhook.EnqueueMessage(tx, s.service.Config, msg)
		}); err != nil {
			slog.Warn("smtp failed to store message", "recipient", msg.Recipient, "message_id", msg.ID, "error", err)
			return &gosmtp.SMTPError{Code: 451, Message: "failed to store message"}
		}
		if s.service.Hub != nil {
			s.service.Hub.Publish(recipient.Parts.Recipient, events.MessageEvent{
				ID:        msg.ID,
				Recipient: msg.Recipient,
				Subject:   msg.Subject,
				From:      msg.FromAddress,
				CreatedAt: now.Format(time.RFC3339),
			})
		}
	}
	return nil
}

func createMessageAttachments(tx *gorm.DB, messageID string, parsed []mailparser.ParsedAttachment) error {
	if len(parsed) == 0 {
		return nil
	}
	attachments := make([]models.MessageAttachment, 0, len(parsed))
	for _, attachment := range parsed {
		sequence := attachment.Sequence
		if sequence <= 0 {
			sequence = len(attachments) + 1
		}
		attachments = append(attachments, models.MessageAttachment{
			ID:               uuid.NewString(),
			MessageID:        messageID,
			Sequence:         sequence,
			Filename:         attachment.Filename,
			ContentType:      attachment.ContentType,
			Disposition:      attachment.Disposition,
			ContentID:        attachment.ContentID,
			TransferEncoding: attachment.TransferEncoding,
			SizeBytes:        attachment.SizeBytes,
			SHA256:           attachment.SHA256,
			Inline:           attachment.Inline,
		})
	}
	return tx.Create(&attachments).Error
}

func maxAttachmentBytes(configured, maxMessageBytes int64) int64 {
	if configured > 0 {
		return configured
	}
	if maxMessageBytes > 0 {
		return maxMessageBytes
	}
	return 10 * 1024 * 1024
}

func (s *Session) Reset() {
	s.from = ""
	s.recipients = nil
}

func (s *Session) Logout() error {
	return nil
}

func readLimited(r io.Reader, max int64) ([]byte, error) {
	if max <= 0 {
		max = 10 * 1024 * 1024
	}
	var buf bytes.Buffer
	n, err := io.Copy(&buf, io.LimitReader(r, max+1))
	if err != nil {
		return nil, err
	}
	if n > max {
		return nil, fmt.Errorf("%w: maximum %d bytes", errMessageTooLarge, max)
	}
	return buf.Bytes(), nil
}

var errMessageTooLarge = errors.New("message exceeds size limit")

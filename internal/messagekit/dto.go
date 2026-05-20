package messagekit

import (
	"time"

	"gptmail/internal/mailhtml"
	"gptmail/internal/models"
)

type AttachmentMetadata struct {
	ID               string    `json:"id"`
	MessageID        string    `json:"message_id,omitempty"`
	Sequence         int       `json:"sequence"`
	Filename         string    `json:"filename,omitempty"`
	ContentType      string    `json:"content_type,omitempty"`
	Disposition      string    `json:"disposition,omitempty"`
	ContentID        string    `json:"content_id,omitempty"`
	TransferEncoding string    `json:"transfer_encoding,omitempty"`
	SizeBytes        int64     `json:"size_bytes"`
	SHA256           string    `json:"sha256,omitempty"`
	Inline           bool      `json:"inline"`
	CreatedAt        time.Time `json:"created_at"`
}

type WebhookMessagePayloadDTO struct {
	ID          string               `json:"id"`
	Recipient   string               `json:"recipient"`
	FromAddress string               `json:"from_address"`
	FromName    string               `json:"from_name,omitempty"`
	Subject     string               `json:"subject"`
	TextContent string               `json:"text_content,omitempty"`
	HTMLContent string               `json:"html_content,omitempty"`
	HeadersJSON string               `json:"headers_json,omitempty"`
	Attachments []AttachmentMetadata `json:"attachments"`
	CreatedAt   time.Time            `json:"created_at"`
	ExpiresAt   time.Time            `json:"expires_at"`
}

func WebhookMessagePayload(msg models.Message, attachments []AttachmentMetadata) WebhookMessagePayloadDTO {
	return WebhookMessagePayloadDTO{
		ID:          msg.ID,
		Recipient:   msg.Recipient,
		FromAddress: msg.FromAddress,
		FromName:    msg.FromName,
		Subject:     msg.Subject,
		TextContent: msg.TextContent,
		HTMLContent: mailhtml.Sanitize(msg.HTMLContent),
		HeadersJSON: msg.HeadersJSON,
		Attachments: AttachmentsOrEmpty(attachments),
		CreatedAt:   msg.CreatedAt,
		ExpiresAt:   msg.ExpiresAt,
	}
}

func AttachmentsOrEmpty(attachments []AttachmentMetadata) []AttachmentMetadata {
	if attachments == nil {
		return []AttachmentMetadata{}
	}
	return attachments
}

func AttachmentMetadataDTO(attachment models.MessageAttachment) AttachmentMetadata {
	return AttachmentMetadata{
		ID:               attachment.ID,
		MessageID:        attachment.MessageID,
		Sequence:         attachment.Sequence,
		Filename:         attachment.Filename,
		ContentType:      attachment.ContentType,
		Disposition:      attachment.Disposition,
		ContentID:        attachment.ContentID,
		TransferEncoding: attachment.TransferEncoding,
		SizeBytes:        attachment.SizeBytes,
		SHA256:           attachment.SHA256,
		Inline:           attachment.Inline,
		CreatedAt:        attachment.CreatedAt,
	}
}

func AttachmentMetadataDTOs(attachments []models.MessageAttachment) []AttachmentMetadata {
	out := make([]AttachmentMetadata, 0, len(attachments))
	for _, attachment := range attachments {
		out = append(out, AttachmentMetadataDTO(attachment))
	}
	return out
}

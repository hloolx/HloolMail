package httpapi

import (
	"strings"
	"time"

	"gptmail/internal/mailhtml"
	"gptmail/internal/messagekit"
	"gptmail/internal/models"
)

type AttachmentMetadata = messagekit.AttachmentMetadata

type MessageSummaryDTO struct {
	ID              string    `json:"id"`
	Recipient       string    `json:"recipient"`
	FromAddress     string    `json:"from_address"`
	FromName        string    `json:"from_name,omitempty"`
	Subject         string    `json:"subject"`
	Seen            bool      `json:"seen"`
	Preview         string    `json:"preview"`
	AttachmentCount int64     `json:"attachment_count"`
	CreatedAt       time.Time `json:"created_at"`
	ExpiresAt       time.Time `json:"expires_at"`
}

type MessageAutomationDetailDTO struct {
	ID              string               `json:"id"`
	Recipient       string               `json:"recipient"`
	FromAddress     string               `json:"from_address"`
	FromName        string               `json:"from_name,omitempty"`
	Subject         string               `json:"subject"`
	Seen            bool                 `json:"seen"`
	TextContent     string               `json:"text_content,omitempty"`
	HeadersJSON     string               `json:"headers_json,omitempty"`
	AttachmentCount int64                `json:"attachment_count"`
	Attachments     []AttachmentMetadata `json:"attachments"`
	CreatedAt       time.Time            `json:"created_at"`
	ExpiresAt       time.Time            `json:"expires_at"`
}

type MessageDetailDTO struct {
	MessageAutomationDetailDTO
	HTMLContent string `json:"html_content,omitempty"`
}

type PublicSharedMailboxMessageDTO struct {
	ID          string               `json:"id"`
	Recipient   string               `json:"recipient"`
	FromAddress string               `json:"from_address"`
	FromName    string               `json:"from_name,omitempty"`
	Subject     string               `json:"subject"`
	TextContent string               `json:"text_content,omitempty"`
	HTMLContent string               `json:"html_content,omitempty"`
	Attachments []AttachmentMetadata `json:"attachments"`
	CreatedAt   time.Time            `json:"created_at"`
	ExpiresAt   time.Time            `json:"expires_at"`
}

type WebhookMessagePayloadDTO = messagekit.WebhookMessagePayloadDTO

type ShareLinkDTO struct {
	ID             uint       `json:"id"`
	ResourceType   string     `json:"resource_type"`
	MailboxID      *uint      `json:"mailbox_id,omitempty"`
	MailboxEmail   string     `json:"mailbox_email,omitempty"`
	Token          string     `json:"token,omitempty"`
	AccessKey      string     `json:"access_key,omitempty"`
	TokenPrefix    string     `json:"token_prefix"`
	ShareURL       string     `json:"share_url,omitempty"`
	AccessURL      string     `json:"access_url,omitempty"`
	KeySet         bool       `json:"key_set"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	RevokedAt      *time.Time `json:"revoked_at,omitempty"`
	AccessCount    int64      `json:"access_count"`
	LastAccessedAt *time.Time `json:"last_accessed_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type AdminShareLinkDTO struct {
	ID             uint       `json:"id"`
	ResourceType   string     `json:"resource_type"`
	MailboxID      *uint      `json:"mailbox_id,omitempty"`
	TokenPrefix    string     `json:"token_prefix"`
	KeySet         bool       `json:"key_set"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	RevokedAt      *time.Time `json:"revoked_at,omitempty"`
	AccessCount    int64      `json:"access_count"`
	LastAccessedAt *time.Time `json:"last_accessed_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	OwnerID        uint       `json:"owner_id"`
	OwnerEmail     string     `json:"owner_email,omitempty"`
	OwnerRole      string     `json:"owner_role,omitempty"`
	MailboxEmail   string     `json:"mailbox_email,omitempty"`
	MailboxOwnerID uint       `json:"mailbox_owner_id,omitempty"`
}

type WebhookEndpointDTO struct {
	ID            uint       `json:"id"`
	Name          string     `json:"name"`
	URL           string     `json:"url"`
	Secret        string     `json:"secret,omitempty"`
	SecretPreview string     `json:"secret_preview,omitempty"`
	Enabled       bool       `json:"enabled"`
	Events        []string   `json:"events"`
	Scope         string     `json:"scope"`
	DomainID      *uint      `json:"domain_id,omitempty"`
	MailboxID     *uint      `json:"mailbox_id,omitempty"`
	LastSuccessAt *time.Time `json:"last_success_at,omitempty"`
	LastFailureAt *time.Time `json:"last_failure_at,omitempty"`
	FailureCount  int        `json:"failure_count"`
	DisabledAt    *time.Time `json:"disabled_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type AdminWebhookEndpointDTO struct {
	ID            uint       `json:"id"`
	OwnerID       uint       `json:"owner_id"`
	OwnerEmail    string     `json:"owner_email,omitempty"`
	OwnerRole     string     `json:"owner_role,omitempty"`
	Name          string     `json:"name"`
	URL           string     `json:"url"`
	Enabled       bool       `json:"enabled"`
	Events        []string   `json:"events"`
	Scope         string     `json:"scope"`
	DomainID      *uint      `json:"domain_id,omitempty"`
	DomainName    string     `json:"domain_name,omitempty"`
	MailboxID     *uint      `json:"mailbox_id,omitempty"`
	MailboxEmail  string     `json:"mailbox_email,omitempty"`
	LastSuccessAt *time.Time `json:"last_success_at,omitempty"`
	LastFailureAt *time.Time `json:"last_failure_at,omitempty"`
	FailureCount  int        `json:"failure_count"`
	DisabledAt    *time.Time `json:"disabled_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type WebhookDeliveryDTO struct {
	ID             string     `json:"id"`
	EndpointID     uint       `json:"endpoint_id"`
	EventType      string     `json:"event_type"`
	MessageID      string     `json:"message_id,omitempty"`
	Status         string     `json:"status"`
	AttemptCount   int        `json:"attempt_count"`
	MaxAttempts    int        `json:"max_attempts"`
	NextAttemptAt  *time.Time `json:"next_attempt_at,omitempty"`
	LastAttemptAt  *time.Time `json:"last_attempt_at,omitempty"`
	SucceededAt    *time.Time `json:"succeeded_at,omitempty"`
	ResponseStatus *int       `json:"response_status,omitempty"`
	ResponseBody   string     `json:"response_body,omitempty"`
	Error          string     `json:"error,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type UserDTO struct {
	ID                    uint       `json:"id"`
	Email                 string     `json:"email"`
	Nickname              string     `json:"nickname"`
	EmailVerified         bool       `json:"email_verified"`
	Role                  string     `json:"role"`
	Enabled               bool       `json:"enabled"`
	DailyLimit            int64      `json:"daily_limit"`
	TotalLimit            int64      `json:"total_limit"`
	UsedToday             int64      `json:"used_today"`
	TotalUsed             int64      `json:"total_used"`
	LastUsedAt            *time.Time `json:"last_used_at,omitempty"`
	PublicMailboxCreated  int64      `json:"public_mailbox_created"`
	PublicMailboxToday    int64      `json:"public_mailbox_today"`
	PublicMailboxDate     string     `json:"public_mailbox_date,omitempty"`
	PrivateMailboxCreated int64      `json:"private_mailbox_created"`
	OnboardingRequired    bool       `json:"onboarding_required"`
	OnboardingCompletedAt *time.Time `json:"onboarding_completed_at,omitempty"`
	OnboardingSkippedAt   *time.Time `json:"onboarding_skipped_at,omitempty"`
	CreatedAt             time.Time  `json:"created_at"`
	UpdatedAt             time.Time  `json:"updated_at"`
}

type nextEmailMessageDTO struct {
	models.Message
	AttachmentCount int64                `json:"attachment_count"`
	Attachments     []AttachmentMetadata `json:"attachments"`
}

type messageSummary = MessageSummaryDTO
type publicMessageDetailDTO = MessageAutomationDetailDTO
type webMessageDetailDTO = MessageDetailDTO

func messageSummaries(messages []models.Message) []messageSummary {
	out := make([]messageSummary, 0, len(messages))
	for _, msg := range messages {
		out = append(out, messageSummaryDTO(msg))
	}
	return out
}

func messageSummaryDTO(msg models.Message, attachmentCount ...int64) MessageSummaryDTO {
	preview := strings.TrimSpace(msg.TextContent)
	if preview == "" {
		preview = strings.TrimSpace(stripTags(msg.HTMLContent))
	}
	if len(preview) > 180 {
		preview = preview[:180]
	}
	count := int64(0)
	if len(attachmentCount) > 0 {
		count = attachmentCount[0]
	}
	return MessageSummaryDTO{
		ID:              msg.ID,
		Recipient:       msg.Recipient,
		FromAddress:     msg.FromAddress,
		FromName:        msg.FromName,
		Subject:         msg.Subject,
		Seen:            msg.Seen,
		Preview:         preview,
		AttachmentCount: count,
		CreatedAt:       msg.CreatedAt,
		ExpiresAt:       msg.ExpiresAt,
	}
}

func publicMessageDetail(msg models.Message, attachments ...[]AttachmentMetadata) publicMessageDetailDTO {
	metadata := optionalAttachments(attachments)
	return MessageAutomationDetailDTO{
		ID:              msg.ID,
		Recipient:       msg.Recipient,
		FromAddress:     msg.FromAddress,
		FromName:        msg.FromName,
		Subject:         msg.Subject,
		Seen:            msg.Seen,
		TextContent:     msg.TextContent,
		HeadersJSON:     msg.HeadersJSON,
		AttachmentCount: int64(len(metadata)),
		Attachments:     metadata,
		CreatedAt:       msg.CreatedAt,
		ExpiresAt:       msg.ExpiresAt,
	}
}

func webMessageDetail(msg models.Message, attachments ...[]AttachmentMetadata) webMessageDetailDTO {
	return MessageDetailDTO{
		MessageAutomationDetailDTO: publicMessageDetail(msg, optionalAttachments(attachments)),
		HTMLContent:                msg.HTMLContent,
	}
}

func publicSharedMailboxMessageDTO(msg models.Message, attachments []AttachmentMetadata) PublicSharedMailboxMessageDTO {
	return PublicSharedMailboxMessageDTO{
		ID:          msg.ID,
		Recipient:   msg.Recipient,
		FromAddress: msg.FromAddress,
		FromName:    msg.FromName,
		Subject:     msg.Subject,
		TextContent: msg.TextContent,
		HTMLContent: mailhtml.Sanitize(msg.HTMLContent),
		Attachments: attachmentsOrEmpty(attachments),
		CreatedAt:   msg.CreatedAt,
		ExpiresAt:   msg.ExpiresAt,
	}
}

func webhookMessagePayloadDTO(msg models.Message, attachments []AttachmentMetadata) WebhookMessagePayloadDTO {
	return messagekit.WebhookMessagePayload(msg, attachments)
}

func userDTO(user models.User) UserDTO {
	return UserDTO{
		ID:                    user.ID,
		Email:                 user.Email,
		Nickname:              user.Nickname,
		EmailVerified:         user.EmailVerified,
		Role:                  user.Role,
		Enabled:               user.Enabled,
		DailyLimit:            user.DailyLimit,
		TotalLimit:            user.TotalLimit,
		UsedToday:             user.UsedToday,
		TotalUsed:             user.TotalUsed,
		LastUsedAt:            user.LastUsedAt,
		PublicMailboxCreated:  user.PublicMailboxCreated,
		PublicMailboxToday:    user.PublicMailboxToday,
		PublicMailboxDate:     user.PublicMailboxDate,
		PrivateMailboxCreated: user.PrivateMailboxCreated,
		OnboardingRequired:    user.OnboardingRequired,
		OnboardingCompletedAt: user.OnboardingCompletedAt,
		OnboardingSkippedAt:   user.OnboardingSkippedAt,
		CreatedAt:             user.CreatedAt,
		UpdatedAt:             user.UpdatedAt,
	}
}

func userDTOs(users []models.User) []UserDTO {
	out := make([]UserDTO, 0, len(users))
	for _, user := range users {
		out = append(out, userDTO(user))
	}
	return out
}

func attachmentsOrEmpty(attachments []AttachmentMetadata) []AttachmentMetadata {
	if attachments == nil {
		return []AttachmentMetadata{}
	}
	return attachments
}

func optionalAttachments(values [][]AttachmentMetadata) []AttachmentMetadata {
	if len(values) == 0 {
		return []AttachmentMetadata{}
	}
	return attachmentsOrEmpty(values[0])
}

func attachmentMetadataDTO(attachment models.MessageAttachment) AttachmentMetadata {
	return messagekit.AttachmentMetadataDTO(attachment)
}

func attachmentMetadataDTOs(attachments []models.MessageAttachment) []AttachmentMetadata {
	return messagekit.AttachmentMetadataDTOs(attachments)
}

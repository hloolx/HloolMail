package models

import (
	"time"

	"gorm.io/gorm"
)

const (
	DomainModePublic  = "public"
	DomainModePrivate = "private"

	UserRoleUser  = "user"
	UserRoleAdmin = "admin"

	PendingDomainTTL = 2 * time.Hour

	ShareResourceTypeMessage = "message"
	ShareResourceTypeMailbox = "mailbox"

	WebhookEventMessageReceived = "message.received"
	WebhookEventEndpointTest    = "endpoint.test"

	WebhookScopeAll     = "all"
	WebhookScopeDomain  = "domain"
	WebhookScopeMailbox = "mailbox"

	WebhookDeliveryStatusPending    = "pending"
	WebhookDeliveryStatusDelivering = "delivering"
	WebhookDeliveryStatusRetry      = "retry"
	WebhookDeliveryStatusSucceeded  = "succeeded"
	WebhookDeliveryStatusFailed     = "failed"
)

type User struct {
	ID                    uint       `gorm:"primaryKey" json:"id"`
	Email                 string     `gorm:"uniqueIndex;size:255;not null" json:"email"`
	PasswordHash          string     `gorm:"not null" json:"-"`
	AvatarURL             string     `gorm:"type:text" json:"avatar_url,omitempty"`
	EmailVerified         bool       `gorm:"not null;default:false" json:"email_verified"`
	Role                  string     `gorm:"size:20;index;not null" json:"role"`
	Enabled               bool       `gorm:"index;not null" json:"enabled"`
	DailyLimit            int64      `gorm:"not null" json:"daily_limit"`
	TotalLimit            int64      `gorm:"not null" json:"total_limit"`
	UsedToday             int64      `gorm:"not null" json:"used_today"`
	TotalUsed             int64      `gorm:"not null" json:"total_used"`
	LastUsedAt            *time.Time `json:"last_used_at,omitempty"`
	PublicMailboxCreated  int64      `gorm:"not null;default:0" json:"public_mailbox_created"`
	PublicMailboxToday    int64      `gorm:"not null;default:0" json:"public_mailbox_today"`
	PublicMailboxDate     string     `gorm:"size:10;not null;default:''" json:"public_mailbox_date"`
	PrivateMailboxCreated int64      `gorm:"not null;default:0" json:"private_mailbox_created"`
	CreatedAt             time.Time  `json:"created_at"`
	UpdatedAt             time.Time  `json:"updated_at"`
}

type OAuthIdentity struct {
	ID           uint       `gorm:"primaryKey" json:"id"`
	UserID       uint       `gorm:"index;not null" json:"user_id"`
	User         User       `gorm:"foreignKey:UserID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	Provider     string     `gorm:"size:32;uniqueIndex:idx_oauth_provider_uid;not null" json:"provider"`
	ProviderUID  string     `gorm:"size:255;uniqueIndex:idx_oauth_provider_uid;not null" json:"provider_uid"`
	AccessToken  string     `gorm:"type:text" json:"-"`
	RefreshToken string     `gorm:"type:text" json:"-"`
	TokenExpiry  *time.Time `json:"token_expiry,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

func (OAuthIdentity) TableName() string {
	return "oauth_identities"
}

type PasskeyCredential struct {
	ID           uint       `gorm:"primaryKey" json:"id"`
	UserID       uint       `gorm:"index;not null" json:"user_id"`
	User         User       `gorm:"foreignKey:UserID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	CredentialID string     `gorm:"uniqueIndex;size:512;not null" json:"credential_id"`
	Name         string     `gorm:"size:120;not null" json:"name"`
	Credential   string     `gorm:"type:text;not null" json:"-"`
	LastUsedAt   *time.Time `json:"last_used_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type WebAuthnSession struct {
	ID        string    `gorm:"primaryKey;size:64;not null" json:"id"`
	UserID    uint      `gorm:"index;not null" json:"user_id"`
	Kind      string    `gorm:"size:20;index;not null" json:"kind"`
	Data      string    `gorm:"type:text;not null" json:"-"`
	ExpiresAt time.Time `gorm:"index;not null" json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

type OAuthProviderSetting struct {
	Provider     string    `gorm:"primaryKey;size:32;not null" json:"provider"`
	ClientID     string    `gorm:"type:text" json:"client_id"`
	ClientSecret string    `gorm:"type:text" json:"-"`
	RedirectURL  string    `gorm:"type:text" json:"redirect_url"`
	Enabled      bool      `gorm:"index;not null" json:"enabled"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (OAuthProviderSetting) TableName() string {
	return "oauth_provider_settings"
}

type Domain struct {
	ID                   uint            `gorm:"primaryKey" json:"id"`
	Domain               string          `gorm:"uniqueIndex;size:255;not null" json:"domain"`
	Mode                 string          `gorm:"size:20;index;not null" json:"mode"`
	OwnerID              *uint           `gorm:"index" json:"owner_id,omitempty"`
	Owner                *User           `gorm:"foreignKey:OwnerID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"-"`
	Active               bool            `gorm:"index;not null" json:"active"`
	MXVerified           bool            `gorm:"index;not null" json:"mx_verified"`
	WildcardEnabled      bool            `gorm:"index;not null" json:"wildcard_enabled"`
	WildcardRequested    bool            `gorm:"index;not null" json:"wildcard_requested"`
	PrivatePasswordHash  string          `json:"-"`
	VerificationToken    string          `gorm:"size:128;not null" json:"-"`
	LastMXCheckAt        *time.Time      `json:"last_mx_check_at,omitempty"`
	LastMXRecords        string          `gorm:"type:text" json:"last_mx_records,omitempty"`
	LastCheckMessage     string          `gorm:"type:text" json:"last_check_message,omitempty"`
	MXAutoRetryEnabled   bool            `gorm:"index;not null" json:"mx_auto_retry_enabled"`
	MXAutoRetryStartedAt *time.Time      `json:"mx_auto_retry_started_at,omitempty"`
	MXAutoRetryUntil     *time.Time      `gorm:"index" json:"mx_auto_retry_until,omitempty"`
	MXAutoRetryNextAt    *time.Time      `gorm:"index" json:"mx_auto_retry_next_at,omitempty"`
	MXAutoRetryLastAt    *time.Time      `json:"mx_auto_retry_last_at,omitempty"`
	MXAutoRetryCount     int             `gorm:"not null" json:"mx_auto_retry_count"`
	FirstVerifiedAt      *time.Time      `gorm:"index" json:"first_verified_at,omitempty"`
	PendingDeleteAt      *time.Time      `gorm:"index" json:"pending_delete_at,omitempty"`
	DomainExpiresAt      *time.Time      `json:"domain_expires_at,omitempty"`
	MailboxCreatedCount  int64           `gorm:"not null;default:0" json:"mailbox_created_count"`
	HealthFailureCount   int             `gorm:"not null" json:"health_failure_count"`
	HealthRecoveryCount  int             `gorm:"not null" json:"health_recovery_count"`
	LastHealthStatus     string          `gorm:"size:40;index" json:"last_health_status,omitempty"`
	LastHealthRunID      *uint           `gorm:"index" json:"last_health_run_id,omitempty"`
	LastHealthRun        *DomainCheckRun `gorm:"foreignKey:LastHealthRunID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"-"`
	LastHealthyAt        *time.Time      `json:"last_healthy_at,omitempty"`
	LastUnhealthyAt      *time.Time      `json:"last_unhealthy_at,omitempty"`
	CreatedAt            time.Time       `json:"created_at"`
	UpdatedAt            time.Time       `json:"updated_at"`
}

func (d Domain) HasCompleteVerification() bool {
	return d.MXVerified && (!d.WildcardRequested || d.WildcardEnabled)
}

func (d Domain) IsRootMailboxReady() bool {
	return d.Active && d.MXVerified
}

func (d Domain) IsWildcardReady() bool {
	return d.Active && d.MXVerified && d.WildcardEnabled
}

func (d Domain) IsReady() bool {
	return d.Active && d.HasCompleteVerification()
}

func (d Domain) IsWaitingVerification() bool {
	return d.Active && (!d.MXVerified || (d.WildcardRequested && !d.WildcardEnabled))
}

type APIKey struct {
	ID         uint       `gorm:"primaryKey" json:"id"`
	OwnerID    *uint      `gorm:"index" json:"owner_id,omitempty"`
	Owner      *User      `gorm:"foreignKey:OwnerID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	Name       string     `gorm:"size:120;not null" json:"name"`
	KeyPrefix  string     `gorm:"index;size:32;not null" json:"key_prefix"`
	KeyHash    string     `gorm:"not null" json:"-"`
	KeyValue   string     `gorm:"column:key_value;index;size:128;not null" json:"-"`
	Enabled    bool       `gorm:"index;not null" json:"enabled"`
	DailyLimit int64      `gorm:"not null" json:"daily_limit"`
	TotalLimit int64      `gorm:"not null" json:"total_limit"`
	UsedToday  int64      `gorm:"not null" json:"used_today"`
	TotalUsed  int64      `gorm:"not null" json:"total_used"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

type SessionToken struct {
	JTI        string     `gorm:"primaryKey;size:64;not null" json:"-"`
	UserID     uint       `gorm:"index;not null" json:"user_id"`
	User       User       `gorm:"foreignKey:UserID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	ExpiresAt  time.Time  `gorm:"index;not null" json:"expires_at"`
	LastSeenAt *time.Time `json:"last_seen_at,omitempty"`
	RevokedAt  *time.Time `gorm:"index" json:"revoked_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

type Message struct {
	ID              string         `gorm:"primaryKey;size:36;not null" json:"id"`
	Recipient       string         `gorm:"index:idx_messages_recipient_created,priority:1;size:320;not null" json:"recipient"`
	RecipientLocal  string         `gorm:"size:160;not null" json:"recipient_local"`
	RecipientDomain string         `gorm:"index;size:255;not null" json:"recipient_domain"`
	RootDomain      string         `gorm:"size:255;not null" json:"root_domain"`
	DomainID        *uint          `gorm:"index" json:"domain_id,omitempty"`
	DomainRef       *Domain        `gorm:"foreignKey:DomainID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"-"`
	FromAddress     string         `gorm:"size:320;not null" json:"from_address"`
	FromName        string         `gorm:"size:255" json:"from_name,omitempty"`
	Subject         string         `gorm:"size:500;not null" json:"subject"`
	Seen            bool           `gorm:"index;not null;default:false" json:"seen"`
	TextContent     string         `gorm:"type:text" json:"text_content,omitempty"`
	HTMLContent     string         `gorm:"type:text" json:"html_content,omitempty"`
	HeadersJSON     string         `gorm:"type:text" json:"headers_json,omitempty"`
	CreatedAt       time.Time      `gorm:"index:idx_messages_recipient_created,priority:2" json:"created_at"`
	ExpiresAt       time.Time      `gorm:"index;not null" json:"expires_at"`
	DeletedAt       gorm.DeletedAt `gorm:"index" json:"-"`
}

type MessageAttachment struct {
	ID               string    `gorm:"primaryKey;size:36;not null" json:"id"`
	MessageID        string    `gorm:"size:36;not null;index;uniqueIndex:idx_message_attachment_sequence,priority:1" json:"message_id"`
	Message          Message   `gorm:"foreignKey:MessageID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	Sequence         int       `gorm:"not null;uniqueIndex:idx_message_attachment_sequence,priority:2" json:"sequence"`
	Filename         string    `gorm:"size:500" json:"filename,omitempty"`
	ContentType      string    `gorm:"size:255" json:"content_type,omitempty"`
	Disposition      string    `gorm:"size:40" json:"disposition,omitempty"`
	ContentID        string    `gorm:"size:255" json:"content_id,omitempty"`
	TransferEncoding string    `gorm:"size:40" json:"transfer_encoding,omitempty"`
	SizeBytes        int64     `gorm:"not null" json:"size_bytes"`
	SHA256           string    `gorm:"size:64;not null" json:"sha256,omitempty"`
	Inline           bool      `gorm:"not null;default:false" json:"inline"`
	CreatedAt        time.Time `json:"created_at"`
}

type ShareLink struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	OwnerID        uint           `gorm:"index;not null" json:"owner_id"`
	Owner          User           `gorm:"foreignKey:OwnerID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	TokenHash      string         `gorm:"type:text;not null" json:"-"`
	TokenPrefix    string         `gorm:"index;size:32;not null" json:"token_prefix"`
	ResourceType   string         `gorm:"size:40;index;not null;default:mailbox" json:"resource_type"`
	MessageID      *string        `gorm:"size:36;index" json:"message_id,omitempty"`
	Message        *Message       `gorm:"foreignKey:MessageID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	MailboxID      *uint          `gorm:"index" json:"mailbox_id,omitempty"`
	Mailbox        *Mailbox       `gorm:"foreignKey:MailboxID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	AccessKeyHash  string         `gorm:"type:text" json:"-"`
	PasswordHash   string         `gorm:"type:text" json:"-"`
	ExpiresAt      *time.Time     `gorm:"index" json:"expires_at,omitempty"`
	RevokedAt      *time.Time     `gorm:"index" json:"revoked_at,omitempty"`
	AccessCount    int64          `gorm:"not null;default:0" json:"access_count"`
	LastAccessedAt *time.Time     `json:"last_accessed_at,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}

type ShareLinkAccessLog struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	ShareLinkID   uint      `gorm:"index;not null" json:"share_link_id"`
	ShareLink     ShareLink `gorm:"foreignKey:ShareLinkID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	OwnerID       uint      `gorm:"index;not null" json:"owner_id"`
	Owner         User      `gorm:"foreignKey:OwnerID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	ResourceType  string    `gorm:"size:40;index;not null" json:"resource_type"`
	MessageID     *string   `gorm:"size:36;index" json:"message_id,omitempty"`
	MailboxID     *uint     `gorm:"index" json:"mailbox_id,omitempty"`
	Success       bool      `gorm:"index;not null" json:"success"`
	FailureReason string    `gorm:"size:120" json:"failure_reason,omitempty"`
	IP            string    `gorm:"size:120;not null" json:"ip"`
	UserAgent     string    `gorm:"size:500;not null" json:"user_agent"`
	CreatedAt     time.Time `json:"created_at"`
}

type WebhookEndpoint struct {
	ID            uint           `gorm:"primaryKey" json:"id"`
	OwnerID       uint           `gorm:"index;not null" json:"owner_id"`
	Owner         User           `gorm:"foreignKey:OwnerID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	Name          string         `gorm:"size:120;not null" json:"name"`
	URL           string         `gorm:"type:text;not null" json:"url"`
	Secret        string         `gorm:"type:text;not null" json:"-"`
	SecretPreview string         `gorm:"size:80;not null" json:"secret_preview"`
	Enabled       bool           `gorm:"index;not null;default:true" json:"enabled"`
	EventsJSON    string         `gorm:"type:text;not null" json:"-"`
	Scope         string         `gorm:"size:40;index;not null;default:all" json:"scope"`
	DomainID      *uint          `gorm:"index" json:"domain_id,omitempty"`
	Domain        *Domain        `gorm:"foreignKey:DomainID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"-"`
	MailboxID     *uint          `gorm:"index" json:"mailbox_id,omitempty"`
	Mailbox       *Mailbox       `gorm:"foreignKey:MailboxID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"-"`
	LastSuccessAt *time.Time     `json:"last_success_at,omitempty"`
	LastFailureAt *time.Time     `json:"last_failure_at,omitempty"`
	FailureCount  int            `gorm:"not null;default:0" json:"failure_count"`
	DisabledAt    *time.Time     `gorm:"index" json:"disabled_at,omitempty"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
	DeletedAt     gorm.DeletedAt `gorm:"index" json:"-"`
}

type WebhookDelivery struct {
	ID             string          `gorm:"primaryKey;size:36;not null" json:"id"`
	EndpointID     uint            `gorm:"index;not null" json:"endpoint_id"`
	Endpoint       WebhookEndpoint `gorm:"foreignKey:EndpointID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	OwnerID        uint            `gorm:"index;not null" json:"owner_id"`
	Owner          User            `gorm:"foreignKey:OwnerID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	EventType      string          `gorm:"size:80;index;not null" json:"event_type"`
	MessageID      string          `gorm:"size:36;index" json:"message_id,omitempty"`
	PayloadJSON    string          `gorm:"type:text;not null" json:"payload_json"`
	DedupKey       string          `gorm:"uniqueIndex;size:180;not null" json:"dedup_key"`
	Status         string          `gorm:"size:40;index;not null" json:"status"`
	AttemptCount   int             `gorm:"not null;default:0" json:"attempt_count"`
	MaxAttempts    int             `gorm:"not null;default:8" json:"max_attempts"`
	NextAttemptAt  *time.Time      `gorm:"index" json:"next_attempt_at,omitempty"`
	LockedAt       *time.Time      `gorm:"index" json:"locked_at,omitempty"`
	LockedBy       string          `gorm:"size:120" json:"locked_by,omitempty"`
	LastAttemptAt  *time.Time      `json:"last_attempt_at,omitempty"`
	SucceededAt    *time.Time      `json:"succeeded_at,omitempty"`
	ResponseStatus *int            `json:"response_status,omitempty"`
	ResponseBody   string          `gorm:"type:text" json:"response_body,omitempty"`
	Error          string          `gorm:"type:text" json:"error,omitempty"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

type Mailbox struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	OwnerID   uint      `gorm:"index;not null" json:"owner_id"`
	Owner     User      `gorm:"foreignKey:OwnerID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	Email     string    `gorm:"uniqueIndex;size:320;not null" json:"email"`
	LocalPart string    `gorm:"size:160;not null" json:"local_part"`
	Host      string    `gorm:"index;size:255;not null" json:"host"`
	DomainID  uint      `gorm:"index;not null" json:"domain_id"`
	DomainRef Domain    `gorm:"foreignKey:DomainID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type APIUsageLog struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	APIKeyID  *uint     `gorm:"index" json:"api_key_id,omitempty"`
	UserID    *uint     `gorm:"index" json:"user_id,omitempty"`
	APIKey    *APIKey   `gorm:"foreignKey:APIKeyID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"-"`
	User      *User     `gorm:"foreignKey:UserID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"-"`
	Path      string    `gorm:"size:500;not null" json:"path"`
	Method    string    `gorm:"size:20;not null" json:"method"`
	IP        string    `gorm:"size:120;not null" json:"ip"`
	UserAgent string    `gorm:"size:500;not null" json:"user_agent"`
	CreatedAt time.Time `json:"created_at"`
}

type Notification struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    *uint     `gorm:"index" json:"user_id,omitempty"`
	DomainID  *uint     `gorm:"index" json:"domain_id,omitempty"`
	User      *User     `gorm:"foreignKey:UserID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"-"`
	DomainRef *Domain   `gorm:"foreignKey:DomainID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"-"`
	Type      string    `gorm:"size:50;index;not null" json:"type"`
	Message   string    `gorm:"type:text;not null" json:"message"`
	Read      bool      `gorm:"index;not null" json:"read"`
	CreatedAt time.Time `json:"created_at"`
}

type Announcement struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	Title     string         `gorm:"size:500;not null" json:"title"`
	Content   string         `gorm:"type:text;not null" json:"content"`
	AdminID   uint           `gorm:"index;not null" json:"admin_id"`
	Admin     *User          `gorm:"foreignKey:AdminID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
}

type AnnouncementRead struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	UserID         uint      `gorm:"uniqueIndex:idx_user_announcement;not null" json:"user_id"`
	AnnouncementID uint      `gorm:"uniqueIndex:idx_user_announcement;not null" json:"announcement_id"`
	ReadAt         time.Time `gorm:"not null" json:"read_at"`
}

type DomainCheckSettings struct {
	ID                 uint       `gorm:"primaryKey" json:"id"`
	Enabled            bool       `gorm:"index;not null" json:"enabled"`
	IntervalMinutes    int        `gorm:"not null" json:"interval_minutes"`
	TimeoutMS          int        `gorm:"not null" json:"timeout_ms"`
	MaxConcurrency     int        `gorm:"not null" json:"max_concurrency"`
	ResolverListJSON   string     `gorm:"type:text;not null" json:"resolver_list_json"`
	CheckInactive      bool       `gorm:"not null" json:"check_inactive"`
	FailureThreshold   int        `gorm:"not null" json:"failure_threshold"`
	RecoveryThreshold  int        `gorm:"not null" json:"recovery_threshold"`
	GlobalProbeEnabled bool       `gorm:"not null" json:"global_probe_enabled"`
	LastRunAt          *time.Time `json:"last_run_at,omitempty"`
	NextRunAt          *time.Time `gorm:"index" json:"next_run_at,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

type DomainCheckRun struct {
	ID           uint       `gorm:"primaryKey" json:"id"`
	Trigger      string     `gorm:"size:40;index;not null" json:"trigger"`
	Status       string     `gorm:"size:40;index;not null" json:"status"`
	Total        int        `gorm:"not null" json:"total"`
	Checked      int        `gorm:"not null" json:"checked"`
	Passed       int        `gorm:"not null" json:"passed"`
	Failed       int        `gorm:"not null" json:"failed"`
	StartedAt    time.Time  `gorm:"not null" json:"started_at"`
	FinishedAt   *time.Time `json:"finished_at,omitempty"`
	ErrorMessage string     `gorm:"type:text" json:"error_message,omitempty"`
}

type DomainCheckResultRecord struct {
	ID            uint           `gorm:"primaryKey" json:"id"`
	RunID         uint           `gorm:"index;not null" json:"run_id"`
	DomainID      uint           `gorm:"index;not null" json:"domain_id"`
	Run           DomainCheckRun `gorm:"foreignKey:RunID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	DomainRef     Domain         `gorm:"foreignKey:DomainID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	Domain        string         `gorm:"size:255;index;not null" json:"domain"`
	ExpectedMX    string         `gorm:"size:255;not null" json:"expected_mx"`
	MXVerified    bool           `gorm:"index;not null" json:"mx_verified"`
	WildcardOK    bool           `gorm:"index;not null" json:"wildcard_ok"`
	Status        string         `gorm:"size:40;index;not null" json:"status"`
	MXRecordsJSON string         `gorm:"type:text;not null" json:"mx_records_json"`
	ProbesJSON    string         `gorm:"type:text;not null" json:"probes_json"`
	ErrorMessage  string         `gorm:"type:text" json:"error_message,omitempty"`
	DurationMS    int64          `gorm:"not null" json:"duration_ms"`
	CreatedAt     time.Time      `gorm:"index" json:"created_at"`
}

type AuditLog struct {
	ID         uint      `gorm:"primaryKey;index:idx_audit_created_id,priority:2;index:idx_audit_category_created_id,priority:3;index:idx_audit_action_created_id,priority:3;index:idx_audit_actor_created_id,priority:3;index:idx_audit_target_created_id,priority:4" json:"id"`
	Category   string    `gorm:"size:40;index:idx_audit_category_created_id,priority:1;not null;default:security" json:"category"`
	Severity   string    `gorm:"size:20;index;not null;default:info" json:"severity"`
	Action     string    `gorm:"size:120;index:idx_audit_action_created_id,priority:1;not null" json:"action"`
	Actor      string    `gorm:"size:120;index:idx_audit_actor_created_id,priority:1;not null" json:"actor"`
	TargetType string    `gorm:"size:60;index:idx_audit_target_created_id,priority:1;not null;default:''" json:"target_type"`
	TargetID   string    `gorm:"size:120;index:idx_audit_target_created_id,priority:2;not null;default:''" json:"target_id"`
	Target     string    `gorm:"size:255;not null" json:"target"`
	Metadata   string    `gorm:"type:text" json:"metadata,omitempty"`
	CreatedAt  time.Time `gorm:"index:idx_audit_created_id,priority:1;index:idx_audit_category_created_id,priority:2;index:idx_audit_action_created_id,priority:2;index:idx_audit_actor_created_id,priority:2;index:idx_audit_target_created_id,priority:3" json:"created_at"`
}

type SystemQuotaSettings struct {
	ID                          uint      `gorm:"primaryKey" json:"id"`
	PublicDomainMailboxLimit    int64     `gorm:"not null;default:0" json:"public_domain_mailbox_limit"`
	UserDailyPublicMailboxLimit int64     `gorm:"not null;default:0" json:"user_daily_public_mailbox_limit"`
	RequirePublicDomainForQuota bool      `gorm:"not null;default:false" json:"require_public_domain_for_quota"`
	CreatedAt                   time.Time `json:"created_at"`
	UpdatedAt                   time.Time `json:"updated_at"`
}

type LoginSettings struct {
	ID                 uint      `gorm:"primaryKey" json:"id"`
	TurnstileEnabled   bool      `gorm:"not null;default:false" json:"turnstile_enabled"`
	TurnstileSiteKey   string    `gorm:"type:text" json:"turnstile_site_key"`
	TurnstileSecretKey string    `gorm:"type:text" json:"-"`
	PasskeyEnabled     bool      `gorm:"not null;default:false" json:"passkey_enabled"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

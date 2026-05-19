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
)

type User struct {
	ID            uint       `gorm:"primaryKey" json:"id"`
	Email         string     `gorm:"uniqueIndex;size:255;not null" json:"email"`
	PasswordHash  string     `gorm:"not null" json:"-"`
	AvatarURL     string     `gorm:"type:text" json:"avatar_url,omitempty"`
	EmailVerified bool       `gorm:"not null;default:false" json:"email_verified"`
	Role          string     `gorm:"size:20;index;not null" json:"role"`
	Enabled       bool       `gorm:"index;not null" json:"enabled"`
	DailyLimit    int64      `gorm:"not null" json:"daily_limit"`
	TotalLimit    int64      `gorm:"not null" json:"total_limit"`
	UsedToday     int64      `gorm:"not null" json:"used_today"`
	TotalUsed     int64      `gorm:"not null" json:"total_used"`
	LastUsedAt    *time.Time `json:"last_used_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
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
	DomainExpiresAt      *time.Time      `json:"domain_expires_at,omitempty"`
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

func (d Domain) IsReady() bool {
	return d.Active && d.MXVerified && (!d.WildcardRequested || d.WildcardEnabled)
}

func (d Domain) IsWaitingVerification() bool {
	return d.Active && (!d.MXVerified || (d.WildcardRequested && !d.WildcardEnabled))
}

func (d Domain) PendingDeleteAt() time.Time {
	return d.CreatedAt.Add(PendingDomainTTL)
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
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
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

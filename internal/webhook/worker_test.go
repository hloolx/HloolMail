package webhook

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"gptmail/internal/config"
	"gptmail/internal/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

type timeoutErr struct{}

func (timeoutErr) Error() string   { return "request timeout" }
func (timeoutErr) Timeout() bool   { return true }
func (timeoutErr) Temporary() bool { return true }

func TestWorkerSignsAndMarksSuccess(t *testing.T) {
	db := webhookTestDB(t)
	endpoint := createWebhookTestEndpoint(t, db, 1, "https://example.com/hook", "super-secret")
	delivery := createWebhookTestDelivery(t, db, endpoint, `{"ok":true}`)
	now := time.Date(2026, 5, 20, 8, 30, 0, 0, time.UTC)
	seen := false
	worker := NewWorker(db)
	worker.Now = func() time.Time { return now }
	worker.Jitter = func(time.Duration) time.Duration { return 0 }
	worker.Resolve = publicExampleResolver
	worker.Client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		seen = true
		body, err := io.ReadAll(req.Body)
		if err != nil {
			t.Fatal(err)
		}
		if string(body) != delivery.PayloadJSON {
			t.Fatalf("payload = %s, want %s", string(body), delivery.PayloadJSON)
		}
		if req.Header.Get("X-Hlool-Event") != models.WebhookEventMessageReceived {
			t.Fatalf("event header = %q", req.Header.Get("X-Hlool-Event"))
		}
		if req.Header.Get("X-Hlool-Delivery") != delivery.ID {
			t.Fatalf("delivery header = %q", req.Header.Get("X-Hlool-Delivery"))
		}
		if req.Header.Get("X-Hlool-Timestamp") != now.Format(time.RFC3339) {
			t.Fatalf("timestamp header = %q", req.Header.Get("X-Hlool-Timestamp"))
		}
		if req.Header.Get("X-Hlool-Attempt") != "1" {
			t.Fatalf("attempt header = %q", req.Header.Get("X-Hlool-Attempt"))
		}
		wantSig := "v1=" + Sign(endpoint.Secret, now.Format(time.RFC3339), delivery.ID, []byte(delivery.PayloadJSON))
		if req.Header.Get("X-Hlool-Signature") != wantSig {
			t.Fatalf("signature = %q, want %q", req.Header.Get("X-Hlool-Signature"), wantSig)
		}
		return webhookHTTPResponse(http.StatusAccepted, "accepted"), nil
	})}

	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !seen {
		t.Fatal("worker did not issue webhook request")
	}
	var refreshed models.WebhookDelivery
	if err := db.First(&refreshed, "id = ?", delivery.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshed.Status != models.WebhookDeliveryStatusSucceeded || refreshed.AttemptCount != 1 || refreshed.SucceededAt == nil {
		t.Fatalf("delivery not marked success: %+v", refreshed)
	}
	var refreshedEndpoint models.WebhookEndpoint
	if err := db.First(&refreshedEndpoint, endpoint.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshedEndpoint.LastSuccessAt == nil || refreshedEndpoint.FailureCount != 0 {
		t.Fatalf("endpoint success accounting mismatch: %+v", refreshedEndpoint)
	}
}

func TestWorkerRetryClassification(t *testing.T) {
	tests := []struct {
		name       string
		statusCode int
		err        error
		wantStatus string
	}{
		{name: "server error retries", statusCode: http.StatusInternalServerError, wantStatus: models.WebhookDeliveryStatusRetry},
		{name: "rate limit retries", statusCode: http.StatusTooManyRequests, wantStatus: models.WebhookDeliveryStatusRetry},
		{name: "timeout retries", err: timeoutErr{}, wantStatus: models.WebhookDeliveryStatusRetry},
		{name: "bad request fails", statusCode: http.StatusBadRequest, wantStatus: models.WebhookDeliveryStatusFailed},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := webhookTestDB(t)
			endpoint := createWebhookTestEndpoint(t, db, 1, "https://example.com/hook", "secret")
			delivery := createWebhookTestDelivery(t, db, endpoint, `{"ok":true}`)
			now := time.Date(2026, 5, 20, 9, 0, 0, 0, time.UTC)
			worker := NewWorker(db)
			worker.Now = func() time.Time { return now }
			worker.Jitter = func(time.Duration) time.Duration { return 0 }
			worker.Resolve = publicExampleResolver
			worker.Client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				if tt.err != nil {
					return nil, tt.err
				}
				return webhookHTTPResponse(tt.statusCode, "body"), nil
			})}
			if err := worker.RunOnce(context.Background()); err != nil {
				t.Fatal(err)
			}
			var refreshed models.WebhookDelivery
			if err := db.First(&refreshed, "id = ?", delivery.ID).Error; err != nil {
				t.Fatal(err)
			}
			if refreshed.Status != tt.wantStatus {
				t.Fatalf("status = %q, want %q; delivery=%+v", refreshed.Status, tt.wantStatus, refreshed)
			}
			if refreshed.AttemptCount != 1 {
				t.Fatalf("attempt count = %d, want 1", refreshed.AttemptCount)
			}
			if tt.wantStatus == models.WebhookDeliveryStatusRetry {
				if refreshed.NextAttemptAt == nil || refreshed.NextAttemptAt.Sub(now) != time.Minute {
					t.Fatalf("next attempt = %v, want +1m", refreshed.NextAttemptAt)
				}
			}
		})
	}
}

func TestWorkerCancelsExpiredMessageDeliveryWithoutPosting(t *testing.T) {
	db := webhookTestDB(t)
	owner := createWebhookTestUser(t, db, "expired-owner@example.test")
	domain := createWebhookTestDomain(t, db, "expired-webhook.test", models.DomainModePrivate, &owner.ID)
	msg := createWebhookTestMessage(t, db, "msg-expired-webhook", "demo@expired-webhook.test", domain)
	endpoint := createWebhookTestEndpointForOwner(t, db, owner.ID, "https://example.com/hook", "secret", models.WebhookScopeAll, nil, nil)
	delivery := createWebhookTestDelivery(t, db, endpoint, `{"message":{"text_content":"old secret","headers_json":"x-private"}}`)
	now := time.Date(2026, 5, 20, 9, 30, 0, 0, time.UTC)
	if err := db.Model(&models.Message{}).Where("id = ?", msg.ID).Update("expires_at", now.Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&models.WebhookDelivery{}).Where("id = ?", delivery.ID).Updates(map[string]any{
		"message_id": msg.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	seen := false
	worker := NewWorker(db)
	worker.Now = func() time.Time { return now }
	worker.Client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		seen = true
		return webhookHTTPResponse(http.StatusAccepted, "accepted"), nil
	})}

	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if seen {
		t.Fatal("worker posted an expired message delivery")
	}
	var refreshed models.WebhookDelivery
	if err := db.First(&refreshed, "id = ?", delivery.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshed.Status != models.WebhookDeliveryStatusFailed || refreshed.AttemptCount != 0 || refreshed.NextAttemptAt != nil {
		t.Fatalf("expired delivery was not canceled: %+v", refreshed)
	}
	if refreshed.Error != RedactionReasonMessageExpired ||
		!strings.Contains(refreshed.PayloadJSON, `"redacted":true`) ||
		strings.Contains(refreshed.PayloadJSON, "old secret") ||
		strings.Contains(refreshed.PayloadJSON, "x-private") {
		t.Fatalf("expired delivery was not redacted: %+v", refreshed)
	}
	var refreshedEndpoint models.WebhookEndpoint
	if err := db.First(&refreshedEndpoint, endpoint.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshedEndpoint.FailureCount != 0 || refreshedEndpoint.LastFailureAt != nil {
		t.Fatalf("message expiry should not count as endpoint failure: %+v", refreshedEndpoint)
	}
}

func TestWorkerLockPreventsDuplicateClaims(t *testing.T) {
	db := webhookTestDB(t)
	endpoint := createWebhookTestEndpoint(t, db, 1, "https://example.com/hook", "secret")
	createWebhookTestDelivery(t, db, endpoint, `{"ok":true}`)
	now := time.Date(2026, 5, 20, 10, 0, 0, 0, time.UTC)
	first := NewWorker(db)
	first.Now = func() time.Time { return now }
	first.LockedBy = "worker-a"
	second := NewWorker(db)
	second.Now = func() time.Time { return now }
	second.LockedBy = "worker-b"

	claimed, err := first.claimDueDeliveries(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(claimed) != 1 {
		t.Fatalf("first claimed %d, want 1", len(claimed))
	}
	claimedAgain, err := second.claimDueDeliveries(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(claimedAgain) != 0 {
		t.Fatalf("second claimed %d, want 0", len(claimedAgain))
	}
}

func TestEnqueueMessageMatchesStrictOwnerAndScope(t *testing.T) {
	db := webhookTestDB(t)
	publicOwner := createWebhookTestUser(t, db, "public-owner@example.test")
	mailboxOwner := createWebhookTestUser(t, db, "mailbox-owner@example.test")
	publicDomain := createWebhookTestDomain(t, db, "public.test", models.DomainModePublic, &publicOwner.ID)
	mailbox := createWebhookTestMailbox(t, db, mailboxOwner, publicDomain, "demo@public.test")
	publicOwnerEndpoint := createWebhookTestEndpointForOwner(t, db, publicOwner.ID, "https://example.com/public", "secret", models.WebhookScopeDomain, &publicDomain.ID, nil)
	mailboxOwnerEndpoint := createWebhookTestEndpointForOwner(t, db, mailboxOwner.ID, "https://example.com/mailbox", "secret", models.WebhookScopeMailbox, nil, &mailbox.ID)
	msg := createWebhookTestMessage(t, db, "msg-public-mailbox", mailbox.Email, publicDomain)
	msg.OwnerID = &mailboxOwner.ID
	msg.MailboxID = &mailbox.ID
	if err := db.Model(&msg).Updates(map[string]any{"owner_id": mailboxOwner.ID, "mailbox_id": mailbox.ID}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.MessageAttachment{
		ID:          "00000000-0000-0000-0000-000000000501",
		MessageID:   msg.ID,
		Sequence:    1,
		Filename:    "report.pdf",
		ContentType: "application/pdf",
		SizeBytes:   12,
		SHA256:      strings.Repeat("a", 64),
	}).Error; err != nil {
		t.Fatal(err)
	}

	if err := EnqueueMessage(db, config.Config{WebhooksEnabled: true}, msg); err != nil {
		t.Fatal(err)
	}
	var deliveries []models.WebhookDelivery
	if err := db.Order("endpoint_id asc").Find(&deliveries).Error; err != nil {
		t.Fatal(err)
	}
	if len(deliveries) != 1 || deliveries[0].EndpointID != mailboxOwnerEndpoint.ID {
		t.Fatalf("deliveries = %+v, want only mailbox owner endpoint %d; public endpoint %d", deliveries, mailboxOwnerEndpoint.ID, publicOwnerEndpoint.ID)
	}
	if strings.Contains(deliveries[0].PayloadJSON, "<script") || !strings.Contains(deliveries[0].PayloadJSON, "report.pdf") {
		t.Fatalf("payload did not reuse sanitized message/attachment DTO: %s", deliveries[0].PayloadJSON)
	}
}

func TestEnqueueMessageDisabledByConfig(t *testing.T) {
	db := webhookTestDB(t)
	owner := createWebhookTestUser(t, db, "owner@example.test")
	domain := createWebhookTestDomain(t, db, "disabled.test", models.DomainModePrivate, &owner.ID)
	createWebhookTestEndpointForOwner(t, db, owner.ID, "https://example.com/hook", "secret", models.WebhookScopeAll, nil, nil)
	msg := createWebhookTestMessage(t, db, "msg-disabled", "random@disabled.test", domain)
	if err := EnqueueMessage(db, config.Config{WebhooksEnabled: false}, msg); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&models.WebhookDelivery{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("deliveries = %d, want 0 when webhooks disabled", count)
	}
}

func TestValidateEndpointURLRejectsUnsafeTargets(t *testing.T) {
	for _, rawURL := range []string{
		"http://example.com/hook",
		"https://user:pass@example.com/hook",
		"https://localhost/hook",
		"https://127.0.0.1/hook",
		"https://10.0.0.1/hook",
		"https://169.254.169.254/latest/meta-data",
	} {
		if err := ValidateEndpointURL(rawURL); err == nil {
			t.Fatalf("expected %q to be rejected", rawURL)
		}
	}
	if err := ValidateEndpointURL("https://example.com/hook"); err != nil {
		t.Fatalf("expected public https URL to pass static validation: %v", err)
	}
}

func TestValidateDeliveryURLRejectsSpecialAddressRanges(t *testing.T) {
	tests := []struct {
		name string
		ip   string
	}{
		{name: "unspecified", ip: "0.0.0.0"},
		{name: "loopback", ip: "127.0.0.1"},
		{name: "private 10", ip: "10.0.0.1"},
		{name: "private 172", ip: "172.16.0.1"},
		{name: "private 192", ip: "192.168.0.1"},
		{name: "link local", ip: "169.254.169.254"},
		{name: "cgnat", ip: "100.64.0.1"},
		{name: "benchmark", ip: "198.18.0.1"},
		{name: "multicast", ip: "224.0.0.1"},
		{name: "ipv6 unspecified", ip: "::"},
		{name: "ipv6 loopback", ip: "::1"},
		{name: "ipv6 ula", ip: "fc00::1"},
		{name: "ipv6 link local", ip: "fe80::1"},
		{name: "ipv6 multicast", ip: "ff02::1"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateDeliveryURL(context.Background(), "https://webhook.example/hook", func(context.Context, string) ([]net.IP, error) {
				return []net.IP{net.ParseIP(tt.ip)}, nil
			})
			if err == nil {
				t.Fatalf("expected %s to be rejected", tt.ip)
			}
		})
	}
}

func TestWorkerRejectsDNSRebindingAtDial(t *testing.T) {
	db := webhookTestDB(t)
	endpoint := createWebhookTestEndpoint(t, db, 1, "https://rebind.example/hook", "secret")
	delivery := createWebhookTestDelivery(t, db, endpoint, `{"ok":true}`)
	now := time.Date(2026, 5, 20, 11, 0, 0, 0, time.UTC)
	resolveCalls := 0
	worker := NewWorker(db)
	worker.Now = func() time.Time { return now }
	worker.Jitter = func(time.Duration) time.Duration { return 0 }
	worker.Resolve = func(context.Context, string) ([]net.IP, error) {
		resolveCalls++
		if resolveCalls == 1 {
			return []net.IP{net.ParseIP("93.184.216.34")}, nil
		}
		return []net.IP{net.ParseIP("127.0.0.1")}, nil
	}

	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	var refreshed models.WebhookDelivery
	if err := db.First(&refreshed, "id = ?", delivery.ID).Error; err != nil {
		t.Fatal(err)
	}
	if resolveCalls < 2 {
		t.Fatalf("resolver called %d times, want dial-time validation after initial validation", resolveCalls)
	}
	if refreshed.Status != models.WebhookDeliveryStatusFailed {
		t.Fatalf("status = %q, want failed; delivery=%+v", refreshed.Status, refreshed)
	}
	if refreshed.AttemptCount != 1 {
		t.Fatalf("attempt count = %d, want 1", refreshed.AttemptCount)
	}
	if !strings.Contains(refreshed.Error, "webhook host address is not allowed") {
		t.Fatalf("error = %q, want forbidden address error", refreshed.Error)
	}
}

func publicExampleResolver(context.Context, string) ([]net.IP, error) {
	return []net.IP{net.ParseIP("93.184.216.34")}, nil
}

func webhookHTTPResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
	}
}

func webhookTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.Domain{}, &models.Mailbox{}, &models.Message{}, &models.MessageAttachment{}, &models.WebhookEndpoint{}, &models.WebhookDelivery{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func createWebhookTestUser(t *testing.T, db *gorm.DB, email string) models.User {
	t.Helper()
	user := models.User{Email: email, PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	return user
}

func createWebhookTestDomain(t *testing.T, db *gorm.DB, name, mode string, ownerID *uint) models.Domain {
	t.Helper()
	domain := models.Domain{Domain: name, Mode: mode, OwnerID: ownerID, Active: true, MXVerified: true, WildcardEnabled: true}
	if err := db.Create(&domain).Error; err != nil {
		t.Fatal(err)
	}
	return domain
}

func createWebhookTestMailbox(t *testing.T, db *gorm.DB, owner models.User, domain models.Domain, email string) models.Mailbox {
	t.Helper()
	local, _, _ := strings.Cut(email, "@")
	mailbox := models.Mailbox{OwnerID: owner.ID, Email: email, LocalPart: local, Host: domain.Domain, DomainID: domain.ID}
	if err := db.Create(&mailbox).Error; err != nil {
		t.Fatal(err)
	}
	return mailbox
}

func createWebhookTestMessage(t *testing.T, db *gorm.DB, id, recipient string, domain models.Domain) models.Message {
	t.Helper()
	local, _, _ := strings.Cut(recipient, "@")
	msg := models.Message{
		ID:              id,
		Recipient:       recipient,
		RecipientLocal:  local,
		RecipientDomain: domain.Domain,
		RootDomain:      domain.Domain,
		DomainID:        &domain.ID,
		FromAddress:     "sender@example.test",
		Subject:         "Webhook message",
		TextContent:     "hello",
		HTMLContent:     `<p>hello</p><script>alert("x")</script>`,
		HeadersJSON:     `{"x-test":"ok"}`,
		ExpiresAt:       time.Now().Add(time.Hour),
	}
	if err := db.Create(&msg).Error; err != nil {
		t.Fatal(err)
	}
	return msg
}

func createWebhookTestEndpoint(t *testing.T, db *gorm.DB, ownerID uint, targetURL, secret string) models.WebhookEndpoint {
	t.Helper()
	return createWebhookTestEndpointForOwner(t, db, ownerID, targetURL, secret, models.WebhookScopeAll, nil, nil)
}

func createWebhookTestEndpointForOwner(t *testing.T, db *gorm.DB, ownerID uint, targetURL, secret, scope string, domainID, mailboxID *uint) models.WebhookEndpoint {
	t.Helper()
	eventsJSON, err := EventsJSON([]string{models.WebhookEventMessageReceived})
	if err != nil {
		t.Fatal(err)
	}
	endpoint := models.WebhookEndpoint{
		OwnerID:       ownerID,
		Name:          "webhook",
		URL:           targetURL,
		Secret:        secret,
		SecretPreview: "preview",
		Enabled:       true,
		EventsJSON:    eventsJSON,
		Scope:         scope,
		DomainID:      domainID,
		MailboxID:     mailboxID,
	}
	if err := db.Create(&endpoint).Error; err != nil {
		t.Fatal(err)
	}
	return endpoint
}

func createWebhookTestDelivery(t *testing.T, db *gorm.DB, endpoint models.WebhookEndpoint, payload string) models.WebhookDelivery {
	t.Helper()
	now := time.Date(2026, 5, 20, 7, 0, 0, 0, time.UTC)
	delivery := models.WebhookDelivery{
		ID:            "00000000-0000-0000-0000-000000000601",
		EndpointID:    endpoint.ID,
		OwnerID:       endpoint.OwnerID,
		EventType:     models.WebhookEventMessageReceived,
		PayloadJSON:   payload,
		DedupKey:      endpoint.Name + ":" + endpoint.URL,
		Status:        models.WebhookDeliveryStatusPending,
		MaxAttempts:   defaultMaxAttempts,
		NextAttemptAt: &now,
	}
	if err := db.Create(&delivery).Error; err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			t.Fatal(err)
		}
		t.Fatal(err)
	}
	return delivery
}

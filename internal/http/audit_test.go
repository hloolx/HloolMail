package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"gptmail/internal/config"
	"gptmail/internal/models"
)

func TestAdminAuditLogsFilterAndPagination(t *testing.T) {
	db := httpTestDB(t)
	now := time.Now().UTC()
	logs := []models.AuditLog{
		{
			Category:   auditCategorySecurity,
			Severity:   auditSeverityWarning,
			Action:     "api_key.reveal",
			Actor:      "admin@example.com",
			TargetType: "api_key",
			TargetID:   "key-one",
			Target:     "key-one",
			CreatedAt:  now.Add(-1 * time.Minute),
		},
		{
			Category:   auditCategoryActivity,
			Severity:   auditSeverityInfo,
			Action:     "mailbox.create",
			Actor:      "user@example.com",
			TargetType: "mailbox",
			TargetID:   "demo@example.test",
			Target:     "demo@example.test",
			CreatedAt:  now.Add(-2 * time.Minute),
		},
		{
			Category:   auditCategorySecurity,
			Severity:   auditSeverityCritical,
			Action:     "user.delete",
			Actor:      "admin@example.com",
			TargetType: "user",
			TargetID:   "old@example.com",
			Target:     "old@example.com",
			CreatedAt:  now.Add(-3 * time.Minute),
		},
	}
	if err := db.Create(&logs).Error; err != nil {
		t.Fatal(err)
	}
	router := testRouterWithConfig(t, db, func(cfg *config.Config) {
		cfg.AdminToken = "test-admin-token"
	})
	headers := map[string]string{"X-Admin-Token": "test-admin-token"}

	// Page 1: category=security, per_page=1 — expect 2 total, first item is newest
	first := perform(router, http.MethodGet, "/api/admin/audit-logs?category=security&per_page=1&page=1", nil, headers)
	if first.Code != http.StatusOK {
		t.Fatalf("first audit page = %d: %s", first.Code, first.Body.String())
	}
	var firstBody struct {
		Data auditLogListResponse `json:"data"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &firstBody); err != nil {
		t.Fatal(err)
	}
	if firstBody.Data.Total != 2 {
		t.Fatalf("expected total=2, got %d", firstBody.Data.Total)
	}
	if len(firstBody.Data.Items) != 1 || firstBody.Data.Items[0].Action != "api_key.reveal" {
		t.Fatalf("unexpected first page: %+v", firstBody.Data.Items)
	}
	if firstBody.Data.Page != 1 || firstBody.Data.TotalPages != 2 {
		t.Fatalf("unexpected page info: page=%d totalPages=%d", firstBody.Data.Page, firstBody.Data.TotalPages)
	}

	// Page 2: same filter, should get user.delete
	second := perform(router, http.MethodGet, "/api/admin/audit-logs?category=security&per_page=1&page=2", nil, headers)
	if second.Code != http.StatusOK {
		t.Fatalf("second audit page = %d: %s", second.Code, second.Body.String())
	}
	var secondBody struct {
		Data auditLogListResponse `json:"data"`
	}
	if err := json.Unmarshal(second.Body.Bytes(), &secondBody); err != nil {
		t.Fatal(err)
	}
	if len(secondBody.Data.Items) != 1 || secondBody.Data.Items[0].Action != "user.delete" {
		t.Fatalf("unexpected second page: %+v", secondBody.Data.Items)
	}

	// Invalid page defaults to 1
	invalid := perform(router, http.MethodGet, "/api/admin/audit-logs?page=not-a-number", nil, headers)
	if invalid.Code != http.StatusOK {
		t.Fatalf("invalid page response = %d: %s", invalid.Code, invalid.Body.String())
	}
}

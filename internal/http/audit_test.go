package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"gptmail/internal/config"
	"gptmail/internal/models"
)

func TestAdminAuditLogsFilterAndCursor(t *testing.T) {
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

	first := perform(router, http.MethodGet, "/api/admin/audit-logs?category=security&limit=1", nil, headers)
	if first.Code != http.StatusOK {
		t.Fatalf("first audit page = %d: %s", first.Code, first.Body.String())
	}
	var firstBody struct {
		Data adminAuditLogsResponse `json:"data"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &firstBody); err != nil {
		t.Fatal(err)
	}
	if len(firstBody.Data.Items) != 1 || firstBody.Data.Items[0].Action != "api_key.reveal" {
		t.Fatalf("unexpected first page: %+v", firstBody.Data.Items)
	}
	if firstBody.Data.NextCursor == "" {
		t.Fatal("expected next cursor")
	}

	second := perform(router, http.MethodGet, "/api/admin/audit-logs?category=security&limit=1&cursor="+firstBody.Data.NextCursor, nil, headers)
	if second.Code != http.StatusOK {
		t.Fatalf("second audit page = %d: %s", second.Code, second.Body.String())
	}
	var secondBody struct {
		Data adminAuditLogsResponse `json:"data"`
	}
	if err := json.Unmarshal(second.Body.Bytes(), &secondBody); err != nil {
		t.Fatal(err)
	}
	if len(secondBody.Data.Items) != 1 || secondBody.Data.Items[0].Action != "user.delete" {
		t.Fatalf("unexpected second page: %+v", secondBody.Data.Items)
	}
}

func TestAdminAuditLogsRejectsInvalidCursor(t *testing.T) {
	db := httpTestDB(t)
	router := testRouterWithConfig(t, db, func(cfg *config.Config) {
		cfg.AdminToken = "test-admin-token"
	})
	response := perform(router, http.MethodGet, "/api/admin/audit-logs?cursor=not-a-cursor", nil, map[string]string{"X-Admin-Token": "test-admin-token"})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid cursor response = %d: %s", response.Code, response.Body.String())
	}
}

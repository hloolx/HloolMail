package httpapi

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gptmail/internal/auth"
	"gptmail/internal/config"
	"gptmail/internal/models"
)

func TestYYDSCompatibilityDisabledDoesNotConsumeAPIKeyQuota(t *testing.T) {
	db := httpTestDB(t)
	owner := models.User{Email: "yyds-owner@example.com", PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	key, plain, err := (auth.APIKeyService{DB: db}).CreateFor(&owner.ID, "yyds-disabled", 1, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)

	response := perform(router, http.MethodGet, "/yyds/v1/domains", nil, map[string]string{"X-API-Key": plain})
	if response.Code != http.StatusNotFound {
		t.Fatalf("disabled YYDS response = %d: %s", response.Code, response.Body.String())
	}

	var refreshed models.APIKey
	if err := db.First(&refreshed, key.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshed.UsedToday != 0 || refreshed.TotalUsed != 0 || refreshed.LastUsedAt != nil {
		t.Fatalf("disabled YYDS consumed quota: used_today=%d total_used=%d last_used_at=%v", refreshed.UsedToday, refreshed.TotalUsed, refreshed.LastUsedAt)
	}
	var usageLogs int64
	if err := db.Model(&models.APIUsageLog{}).Where("api_key_id = ?", key.ID).Count(&usageLogs).Error; err != nil {
		t.Fatal(err)
	}
	if usageLogs != 0 {
		t.Fatalf("disabled YYDS wrote %d APIUsageLog rows", usageLogs)
	}
}

func TestYYDSCompatibilityUnknownRoutesStayJSONWithFrontend(t *testing.T) {
	db := httpTestDB(t)
	owner := models.User{Email: "yyds-owner@example.com", PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	key, plain, err := (auth.APIKeyService{DB: db}).CreateFor(&owner.ID, "yyds-unknown", 5, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	dist := t.TempDir()
	if err := os.WriteFile(filepath.Join(dist, "index.html"), []byte("<!doctype html><html><body>frontend</body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	router := testRouterWithConfig(t, db, func(cfg *config.Config) {
		cfg.FrontendDist = dist
	})

	for _, path := range []string{"/yyds/v1", "/yyds/v1/unknown"} {
		response := perform(router, http.MethodGet, path, nil, map[string]string{"X-API-Key": plain})
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s response = %d: %s", path, response.Code, response.Body.String())
		}
		if contentType := response.Header().Get("Content-Type"); !strings.Contains(contentType, "application/json") {
			t.Fatalf("%s returned non-json content type %q: %s", path, contentType, response.Body.String())
		}
		if strings.Contains(strings.ToLower(response.Body.String()), "<!doctype html") {
			t.Fatalf("%s fell through to frontend html: %s", path, response.Body.String())
		}
	}

	var refreshed models.APIKey
	if err := db.First(&refreshed, key.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshed.UsedToday != 0 || refreshed.TotalUsed != 0 || refreshed.LastUsedAt != nil {
		t.Fatalf("unknown YYDS route consumed quota: used_today=%d total_used=%d last_used_at=%v", refreshed.UsedToday, refreshed.TotalUsed, refreshed.LastUsedAt)
	}
}

func TestYYDSCompatibilityUsesDTOsAndMailboxLogic(t *testing.T) {
	db := httpTestDB(t)
	owner := models.User{Email: "yyds-owner@example.com", PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	domain := models.Domain{
		Domain:     "yyds.test",
		Mode:       models.DomainModePublic,
		Active:     true,
		MXVerified: true,
	}
	if err := db.Create(&domain).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.APIInterfaceSettings{ID: 1, YYDSCompatibilityEnabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	key, plain, err := (auth.APIKeyService{DB: db}).CreateFor(&owner.ID, "yyds-enabled", 20, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	router := testRouter(t, db)
	headers := map[string]string{"X-API-Key": plain}

	domainsResponse := perform(router, http.MethodGet, "/yyds/v1/domains", nil, headers)
	if domainsResponse.Code != http.StatusOK {
		t.Fatalf("YYDS domains response = %d: %s", domainsResponse.Code, domainsResponse.Body.String())
	}
	var domainsBody struct {
		Success bool `json:"success"`
		Data    struct {
			Domains []string `json:"domains"`
		} `json:"data"`
	}
	if err := json.Unmarshal(domainsResponse.Body.Bytes(), &domainsBody); err != nil {
		t.Fatal(err)
	}
	if !domainsBody.Success || len(domainsBody.Data.Domains) != 1 || domainsBody.Data.Domains[0] != "yyds.test" {
		t.Fatalf("YYDS domains body = %+v", domainsBody)
	}

	createResponse := perform(router, http.MethodPost, "/yyds/v1/accounts", map[string]any{
		"localPart": "demo",
		"domain":    "yyds.test",
	}, headers)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("YYDS create account response = %d: %s", createResponse.Code, createResponse.Body.String())
	}
	var createBody struct {
		Success bool `json:"success"`
		Data    struct {
			ID        string    `json:"id"`
			Address   string    `json:"address"`
			Mode      string    `json:"mode"`
			Domain    string    `json:"domain"`
			Token     string    `json:"token"`
			InboxType string    `json:"inboxType"`
			Source    string    `json:"source"`
			ExpiresAt time.Time `json:"expiresAt"`
			IsActive  bool      `json:"isActive"`
			CreatedAt time.Time `json:"createdAt"`
		} `json:"data"`
	}
	if err := json.Unmarshal(createResponse.Body.Bytes(), &createBody); err != nil {
		t.Fatal(err)
	}
	if !createBody.Success || createBody.Data.ID == "" || createBody.Data.Address != "demo@yyds.test" || createBody.Data.Mode != "fixed" || createBody.Data.Domain != "yyds.test" {
		t.Fatalf("YYDS account body = %+v", createBody.Data)
	}
	if createBody.Data.Token != "" || createBody.Data.InboxType != "temp" || createBody.Data.Source != "api" || !createBody.Data.IsActive {
		t.Fatalf("YYDS account compatibility fields = %+v", createBody.Data)
	}
	if !createBody.Data.ExpiresAt.After(createBody.Data.CreatedAt) {
		t.Fatalf("YYDS account expiry %v should be after created_at %v", createBody.Data.ExpiresAt, createBody.Data.CreatedAt)
	}

	var mailbox models.Mailbox
	if err := db.First(&mailbox, "email = ?", createBody.Data.Address).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	message := models.Message{
		ID:              "yyds-message-1",
		Recipient:       createBody.Data.Address,
		RecipientLocal:  "demo",
		RecipientDomain: "yyds.test",
		RootDomain:      "yyds.test",
		DomainID:        &domain.ID,
		OwnerID:         &owner.ID,
		MailboxID:       &mailbox.ID,
		FromAddress:     "sender@example.com",
		FromName:        "Sender",
		Subject:         "YYDS welcome",
		TextContent:     "plain body",
		HTMLContent:     "<p>html body</p>",
		HeadersJSON:     `{"X-Test":"yes"}`,
		CreatedAt:       now,
		ExpiresAt:       now.Add(time.Hour),
	}
	if err := db.Create(&message).Error; err != nil {
		t.Fatal(err)
	}

	listResponse := perform(router, http.MethodGet, "/yyds/v1/messages?address=demo@yyds.test&limit=10", nil, headers)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("YYDS list messages response = %d: %s", listResponse.Code, listResponse.Body.String())
	}
	var listBody struct {
		Success bool `json:"success"`
		Data    struct {
			Messages []struct {
				ID             string `json:"id"`
				InboxID        string `json:"inbox_id"`
				InboxIDCompat  string `json:"inboxId"`
				Subject        string `json:"subject"`
				Seen           bool   `json:"seen"`
				HasAttachments bool   `json:"hasAttachments"`
			} `json:"messages"`
			Total       int64 `json:"total"`
			UnreadCount int64 `json:"unreadCount"`
		} `json:"data"`
	}
	if err := json.Unmarshal(listResponse.Body.Bytes(), &listBody); err != nil {
		t.Fatal(err)
	}
	if !listBody.Success || listBody.Data.Total != 1 || listBody.Data.UnreadCount != 1 || len(listBody.Data.Messages) != 1 {
		t.Fatalf("YYDS list body = %+v", listBody.Data)
	}
	if listBody.Data.Messages[0].ID != message.ID || listBody.Data.Messages[0].InboxID == "" || listBody.Data.Messages[0].InboxID != listBody.Data.Messages[0].InboxIDCompat {
		t.Fatalf("YYDS message summary = %+v", listBody.Data.Messages[0])
	}

	detailResponse := perform(router, http.MethodGet, "/yyds/v1/messages/yyds-message-1?address=demo@yyds.test", nil, headers)
	if detailResponse.Code != http.StatusOK {
		t.Fatalf("YYDS get message response = %d: %s", detailResponse.Code, detailResponse.Body.String())
	}
	var detailBody struct {
		Success bool `json:"success"`
		Data    struct {
			ID      string   `json:"id"`
			Subject string   `json:"subject"`
			Text    string   `json:"text"`
			HTML    []string `json:"html"`
			Seen    bool     `json:"seen"`
		} `json:"data"`
	}
	if err := json.Unmarshal(detailResponse.Body.Bytes(), &detailBody); err != nil {
		t.Fatal(err)
	}
	if !detailBody.Success || detailBody.Data.ID != message.ID || detailBody.Data.Subject != message.Subject || detailBody.Data.Text != message.TextContent || len(detailBody.Data.HTML) != 1 {
		t.Fatalf("YYDS detail body = %+v", detailBody.Data)
	}

	markReadResponse := perform(router, http.MethodPost, "/yyds/v1/messages/mark-read?address=demo@yyds.test", nil, headers)
	if markReadResponse.Code != http.StatusOK {
		t.Fatalf("YYDS mark read response = %d: %s", markReadResponse.Code, markReadResponse.Body.String())
	}
	var markReadBody struct {
		Data struct {
			Mailbox     string `json:"mailbox"`
			Updated     int64  `json:"updated"`
			AlreadySeen int64  `json:"alreadySeen"`
			Total       int64  `json:"total"`
		} `json:"data"`
	}
	if err := json.Unmarshal(markReadResponse.Body.Bytes(), &markReadBody); err != nil {
		t.Fatal(err)
	}
	if markReadBody.Data.Mailbox != "demo@yyds.test" || markReadBody.Data.Updated != 1 || markReadBody.Data.AlreadySeen != 0 || markReadBody.Data.Total != 1 {
		t.Fatalf("YYDS mark read body = %+v", markReadBody.Data)
	}

	sourceResponse := perform(router, http.MethodGet, "/yyds/v1/sources/yyds-message-1?address=demo@yyds.test", nil, headers)
	if sourceResponse.Code != http.StatusOK {
		t.Fatalf("YYDS source response = %d: %s", sourceResponse.Code, sourceResponse.Body.String())
	}
	var sourceBody struct {
		Data struct {
			ID   string `json:"id"`
			Data string `json:"data"`
		} `json:"data"`
	}
	if err := json.Unmarshal(sourceResponse.Body.Bytes(), &sourceBody); err != nil {
		t.Fatal(err)
	}
	if sourceBody.Data.ID != message.ID || sourceBody.Data.Data == "" {
		t.Fatalf("YYDS source body = %+v", sourceBody.Data)
	}

	deleteResponse := perform(router, http.MethodDelete, "/yyds/v1/messages/yyds-message-1?address=demo@yyds.test", nil, headers)
	if deleteResponse.Code != http.StatusNoContent {
		t.Fatalf("YYDS delete message response = %d: %s", deleteResponse.Code, deleteResponse.Body.String())
	}
	var remaining int64
	if err := db.Model(&models.Message{}).Where("id = ?", message.ID).Count(&remaining).Error; err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatalf("message remaining after YYDS delete = %d", remaining)
	}

	var refreshed models.APIKey
	if err := db.First(&refreshed, key.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshed.TotalUsed == 0 {
		t.Fatal("enabled YYDS calls should consume API key quota")
	}
}

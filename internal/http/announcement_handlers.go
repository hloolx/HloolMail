package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"gptmail/internal/auth"
	"gptmail/internal/events"
	"gptmail/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm/clause"
)

func (h *Handler) listAnnouncements(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	var announcements []models.Announcement
	if err := h.DB.Order("created_at desc").Find(&announcements).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ids := make([]uint, len(announcements))
	for i, a := range announcements {
		ids[i] = a.ID
	}
	readMap := map[uint]bool{}
	if len(ids) > 0 {
		var reads []models.AnnouncementRead
		h.DB.Where("user_id = ? AND announcement_id IN ?", user.ID, ids).Find(&reads)
		for _, r := range reads {
			readMap[r.AnnouncementID] = true
		}
	}
	type result struct {
		models.Announcement
		Read bool `json:"read"`
	}
	out := make([]result, len(announcements))
	for i, a := range announcements {
		out[i] = result{Announcement: a, Read: readMap[a.ID]}
	}
	ok(c, out)
}

func (h *Handler) unreadAnnouncementCount(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	var totalActive int64
	if err := h.DB.Model(&models.Announcement{}).Count(&totalActive).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	var readCount int64
	if err := h.DB.Model(&models.AnnouncementRead{}).
		Where("user_id = ? AND announcement_id IN (SELECT id FROM announcements WHERE deleted_at IS NULL)", user.ID).
		Count(&readCount).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	unread := totalActive - readCount
	if unread < 0 {
		unread = 0
	}
	ok(c, gin.H{"unread": unread})
}

func (h *Handler) markAnnouncementRead(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	id, err := auth.ParseUintID(c.Param("id"))
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	var announcement models.Announcement
	if err := h.DB.First(&announcement, "id = ?", id).Error; err != nil {
		fail(c, http.StatusNotFound, "announcement not found")
		return
	}
	read := models.AnnouncementRead{
		UserID:         user.ID,
		AnnouncementID: id,
		ReadAt:         time.Now(),
	}
	if err := h.DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "announcement_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"read_at"}),
	}).Create(&read).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, gin.H{"read": true})
}

func (h *Handler) adminListAnnouncements(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	type announcementWithCount struct {
		models.Announcement
		ReaderCount int64 `json:"reader_count"`
	}
	var announcements []announcementWithCount
	if err := h.DB.Unscoped().Model(&models.Announcement{}).
		Select("announcements.*, (SELECT COUNT(*) FROM announcement_reads WHERE announcement_reads.announcement_id = announcements.id) as reader_count").
		Order("created_at desc").
		Find(&announcements).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, announcements)
}

func (h *Handler) adminCreateAnnouncement(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	var input struct {
		Title   string `json:"title"`
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid json")
		return
	}
	if input.Title == "" {
		fail(c, http.StatusBadRequest, "title is required")
		return
	}
	if input.Content == "" {
		fail(c, http.StatusBadRequest, "content is required")
		return
	}
	var adminUser *models.User
	if u := currentUser(c); u != nil {
		adminUser = u
	} else {
		var u models.User
		if err := h.DB.Where("role = ? AND enabled = ?", models.UserRoleAdmin, true).Order("id asc").First(&u).Error; err != nil {
			fail(c, http.StatusInternalServerError, "no admin user found")
			return
		}
		adminUser = &u
	}
	announcement := models.Announcement{
		Title:   input.Title,
		Content: input.Content,
		AdminID: adminUser.ID,
	}
	if err := h.DB.Create(&announcement).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}

	if h.Hub != nil {
		type announcePayload struct {
			AnnouncementID uint   `json:"announcement_id"`
			Title          string `json:"title"`
			ContentPreview string `json:"content_preview"`
		}
		preview := announcement.Content
		if len(preview) > 200 {
			preview = preview[:200]
		}
		payload := announcePayload{
			AnnouncementID: announcement.ID,
			Title:          announcement.Title,
			ContentPreview: preview,
		}
		msg, _ := json.Marshal(payload)
		h.Hub.PublishNotification([]string{"global"}, events.NotificationEvent{
			Type:      "ANNOUNCEMENT",
			Message:   string(msg),
			CreatedAt: announcement.CreatedAt.Format(time.RFC3339),
		})
	}

	h.audit("announcement.create", actor(c), strconv.FormatUint(uint64(announcement.ID), 10), "")
	created(c, announcement)
}

func (h *Handler) adminDeleteAnnouncement(c *gin.Context) {
	if !h.requireAdmin(c) {
		return
	}
	id, err := auth.ParseUintID(c.Param("id"))
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	var announcement models.Announcement
	if err := h.DB.First(&announcement, "id = ?", id).Error; err != nil {
		fail(c, http.StatusNotFound, "announcement not found")
		return
	}
	if err := h.DB.Delete(&announcement).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.audit("announcement.delete", actor(c), strconv.FormatUint(uint64(id), 10), "")
	ok(c, gin.H{"deleted": true})
}

func (h *Handler) announcementStream(c *gin.Context) {
	_, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	if h.Hub == nil {
		fail(c, http.StatusInternalServerError, "announcement stream unavailable")
		return
	}
	ch, cancel := h.Hub.SubscribeNotifications([]string{notificationGlobalKey})
	defer cancel()

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		fail(c, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	fmt.Fprint(c.Writer, ": connected\n\n")
	flusher.Flush()
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-c.Request.Context().Done():
			return
		case event := <-ch:
			// Only forward announcements, not other notification types
			if event.Type == "ANNOUNCEMENT" {
				c.SSEvent("announcement", event)
				flusher.Flush()
			}
		case <-ticker.C:
			_, _ = c.Writer.Write([]byte(": heartbeat\n\n"))
			flusher.Flush()
		}
	}
}

package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"gptmail/internal/auth"
	"gptmail/internal/events"
	"gptmail/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func (h *Handler) listNotifications(c *gin.Context) {
	user, allowed := h.notificationUser(c)
	if !allowed {
		return
	}
	limit := parseLimit(c.Query("limit"), 20, 100)
	query := h.notificationScope(user).Order("created_at desc").Limit(limit)
	if c.Query("unread") == "true" {
		query = query.Where("read = ?", false)
	}
	var notifications []models.Notification
	if err := query.Find(&notifications).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, notifications)
}

func (h *Handler) unreadNotificationCount(c *gin.Context) {
	user, allowed := h.notificationUser(c)
	if !allowed {
		return
	}
	var count int64
	if err := h.notificationScope(user).Where("read = ?", false).Count(&count).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, gin.H{"unread": count})
}

func (h *Handler) markNotificationRead(c *gin.Context) {
	user, allowed := h.notificationUser(c)
	if !allowed {
		return
	}
	id, err := auth.ParseUintID(c.Param("id"))
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	var notification models.Notification
	if err := h.notificationScope(user).Where("id = ?", id).First(&notification).Error; err != nil {
		fail(c, http.StatusNotFound, "notification not found")
		return
	}
	if !notification.Read {
		notification.Read = true
		if err := h.DB.Save(&notification).Error; err != nil {
			fail(c, http.StatusInternalServerError, err.Error())
			return
		}
	}
	ok(c, notification)
}

func (h *Handler) markAllNotificationsRead(c *gin.Context) {
	user, allowed := h.notificationUser(c)
	if !allowed {
		return
	}
	if err := h.notificationScope(user).Where("read = ?", false).Update("read", true).Error; err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	ok(c, gin.H{"read": true})
}

func (h *Handler) notificationStream(c *gin.Context) {
	user, loggedIn := h.requireLogin(c)
	if !loggedIn {
		return
	}
	if h.Hub == nil {
		fail(c, http.StatusInternalServerError, "notification stream unavailable")
		return
	}
	keys := []string{notificationUserKey(user.ID)}
	if user.Role == models.UserRoleAdmin {
		keys = append(keys, notificationGlobalKey)
	}
	ch, cancel := h.Hub.SubscribeNotifications(keys)
	defer cancel()

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		fail(c, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-c.Request.Context().Done():
			return
		case event := <-ch:
			c.SSEvent("notification", event)
			flusher.Flush()
		case <-ticker.C:
			_, _ = c.Writer.Write([]byte(": ping\n\n"))
			flusher.Flush()
		}
	}
}

func (h *Handler) notificationUser(c *gin.Context) (*models.User, bool) {
	return h.requireLogin(c)
}

func (h *Handler) notificationScope(user *models.User) *gorm.DB {
	query := h.DB.Model(&models.Notification{})
	if user != nil && user.Role == models.UserRoleAdmin {
		return query.Where("user_id = ? OR user_id IS NULL", user.ID)
	}
	if user == nil {
		return query.Where("1 = 0")
	}
	return query.Where("user_id = ?", user.ID)
}

const notificationGlobalKey = "global"

func notificationUserKey(id uint) string {
	return "user:" + strconv.FormatUint(uint64(id), 10)
}

func notificationPublishKeys(userID *uint) []string {
	if userID == nil {
		return []string{notificationGlobalKey}
	}
	return []string{notificationUserKey(*userID)}
}

func notificationEvent(notification models.Notification) events.NotificationEvent {
	return events.NotificationEvent{
		ID:        notification.ID,
		Type:      notification.Type,
		Message:   notification.Message,
		DomainID:  notification.DomainID,
		Read:      notification.Read,
		CreatedAt: notification.CreatedAt.Format(time.RFC3339),
	}
}

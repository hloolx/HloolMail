package httpapi

import (
	"gptmail/internal/models"

	"gorm.io/gorm"
)

func (h *Handler) messageSummariesWithAttachmentCounts(messages []models.Message) ([]messageSummary, error) {
	counts, err := h.attachmentCountsForMessages(messages)
	if err != nil {
		return nil, err
	}
	out := make([]messageSummary, 0, len(messages))
	for _, msg := range messages {
		out = append(out, messageSummaryDTO(msg, counts[msg.ID]))
	}
	return out, nil
}

func (h *Handler) attachmentCountsForMessages(messages []models.Message) (map[string]int64, error) {
	counts := make(map[string]int64, len(messages))
	if len(messages) == 0 {
		return counts, nil
	}
	ids := make([]string, 0, len(messages))
	for _, msg := range messages {
		ids = append(ids, msg.ID)
	}
	var rows []struct {
		MessageID string
		Count     int64
	}
	if err := h.DB.Model(&models.MessageAttachment{}).
		Select("message_id, COUNT(*) AS count").
		Where("message_id IN ?", ids).
		Group("message_id").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		counts[row.MessageID] = row.Count
	}
	return counts, nil
}

func (h *Handler) attachmentMetadataForMessage(messageID string) ([]AttachmentMetadata, error) {
	var attachments []models.MessageAttachment
	if err := h.DB.Where("message_id = ?", messageID).Order("sequence asc").Find(&attachments).Error; err != nil {
		return nil, err
	}
	return attachmentMetadataDTOs(attachments), nil
}

func deleteAttachmentsForMessageQuery(tx *gorm.DB, query *gorm.DB) error {
	return tx.Where("message_id IN (?)", query.Select("id")).Delete(&models.MessageAttachment{}).Error
}

func deleteShareLinksForMessageQuery(tx *gorm.DB, query *gorm.DB) error {
	shareLinks := tx.Model(&models.ShareLink{}).Where("resource_type = ? AND message_id IN (?)", models.ShareResourceTypeMessage, query.Select("id"))
	if err := tx.Where("share_link_id IN (?)", shareLinks.Select("id")).Delete(&models.ShareLinkAccessLog{}).Error; err != nil {
		return err
	}
	return tx.Where("resource_type = ? AND message_id IN (?)", models.ShareResourceTypeMessage, query.Select("id")).Delete(&models.ShareLink{}).Error
}

func deleteShareLinksForMailboxQuery(tx *gorm.DB, mailboxID uint) error {
	shareLinks := tx.Model(&models.ShareLink{}).Where("resource_type = ? AND mailbox_id = ?", models.ShareResourceTypeMailbox, mailboxID)
	if err := tx.Where("share_link_id IN (?)", shareLinks.Select("id")).Delete(&models.ShareLinkAccessLog{}).Error; err != nil {
		return err
	}
	return tx.Where("resource_type = ? AND mailbox_id = ?", models.ShareResourceTypeMailbox, mailboxID).Delete(&models.ShareLink{}).Error
}

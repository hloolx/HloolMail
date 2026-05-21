package httpapi

import (
	"gptmail/internal/messagekit"
	"gptmail/internal/models"

	"gorm.io/gorm"
)

type messageOwnerSource = messagekit.OwnerSource

const (
	messageOwnerSourceMailbox       messageOwnerSource = messagekit.OwnerSourceMailbox
	messageOwnerSourcePrivateDomain messageOwnerSource = messagekit.OwnerSourcePrivateDomain
)

type messageOwnerInfo = messagekit.OwnerInfo

func (h *Handler) messageOwnerForMessage(msg models.Message) (messageOwnerInfo, bool, error) {
	return messagekit.OwnerForMessage(h.DB, msg)
}

func (h *Handler) messageOwnerForRecipient(recipient string, d *models.Domain) (messageOwnerInfo, bool, error) {
	return messagekit.OwnerForRecipient(h.DB, recipient, d)
}

func (h *Handler) actorOwnsMessageRecipient(actor *requestActor, recipient string, d *models.Domain) (bool, error) {
	if actor == nil {
		return false, nil
	}
	if actor.isAdmin() {
		return true, nil
	}
	ownerID, ok := actor.ownerID()
	if !ok {
		return false, nil
	}
	owner, exists, err := h.messageOwnerForRecipient(recipient, d)
	if err != nil || !exists {
		return false, err
	}
	return owner.OwnerID == ownerID, nil
}

func (h *Handler) userOwnsMessageRecipient(user *models.User, recipient string, d *models.Domain) (bool, error) {
	if user == nil {
		return false, nil
	}
	if user.Role == models.UserRoleAdmin {
		return true, nil
	}
	owner, exists, err := h.messageOwnerForRecipient(recipient, d)
	if err != nil || !exists {
		return false, err
	}
	return owner.OwnerID == user.ID, nil
}

func (h *Handler) scopeOwnedMessages(query *gorm.DB, ownerID uint) *gorm.DB {
	return messagekit.ScopeOwnedMessages(h.DB, query, ownerID)
}

func (h *Handler) scopeInboxMessages(query *gorm.DB, actor *requestActor, recipient string, d *models.Domain) (*gorm.DB, error) {
	if actor == nil {
		return query.Where("1 = 0"), nil
	}
	if actor.isAdmin() {
		return query.Where("recipient = ?", recipient), nil
	}
	owner, exists, err := h.messageOwnerForRecipient(recipient, d)
	if err != nil || !exists {
		return query.Where("1 = 0"), err
	}
	actorOwnerID, ok := actor.ownerID()
	if !ok || actorOwnerID != owner.OwnerID {
		return query.Where("1 = 0"), nil
	}
	return h.scopeInboxMessagesForOwner(query, recipient, owner), nil
}

func (h *Handler) scopeInboxMessagesForUser(query *gorm.DB, user *models.User, recipient string, d *models.Domain) (*gorm.DB, error) {
	if user == nil {
		return query.Where("1 = 0"), nil
	}
	if user.Role == models.UserRoleAdmin {
		return query.Where("recipient = ?", recipient), nil
	}
	owner, exists, err := h.messageOwnerForRecipient(recipient, d)
	if err != nil || !exists {
		return query.Where("1 = 0"), err
	}
	if owner.OwnerID != user.ID {
		return query.Where("1 = 0"), nil
	}
	return h.scopeInboxMessagesForOwner(query, recipient, owner), nil
}

func (h *Handler) scopeInboxMessagesForMailbox(query *gorm.DB, mailbox models.Mailbox) *gorm.DB {
	return query.Where("mailbox_id = ?", mailbox.ID)
}

func (h *Handler) scopeInboxMessagesForOwner(query *gorm.DB, recipient string, owner messageOwnerInfo) *gorm.DB {
	if owner.MailboxID != nil {
		return query.Where("mailbox_id = ?", *owner.MailboxID)
	}
	return query.Where("owner_id = ? AND recipient = ? AND mailbox_id IS NULL", owner.OwnerID, recipient)
}

func (h *Handler) actorCanAccessMessage(actor *requestActor, msg models.Message) (bool, error) {
	if actor == nil {
		return false, nil
	}
	if actor.isAdmin() {
		return true, nil
	}
	ownerID, ok := actor.ownerID()
	if !ok {
		return false, nil
	}
	owner, exists, err := h.messageOwnerForMessage(msg)
	if err != nil || !exists {
		return false, err
	}
	return owner.OwnerID == ownerID, nil
}

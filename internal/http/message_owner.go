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

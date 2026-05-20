package messagekit

import (
	"errors"

	"gptmail/internal/models"

	"gorm.io/gorm"
)

type OwnerSource string

const (
	OwnerSourceMailbox       OwnerSource = "mailbox"
	OwnerSourcePrivateDomain OwnerSource = "private_domain"
)

type OwnerInfo struct {
	OwnerID   uint
	Source    OwnerSource
	MailboxID *uint
	DomainID  *uint
}

func OwnerForMessage(db *gorm.DB, msg models.Message) (OwnerInfo, bool, error) {
	var d *models.Domain
	if msg.DomainID != nil {
		var domain models.Domain
		err := db.First(&domain, "id = ?", *msg.DomainID).Error
		if err == nil {
			d = &domain
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return OwnerInfo{}, false, err
		}
	}
	if d == nil && msg.RootDomain != "" {
		var domain models.Domain
		err := db.Where("domain = ?", msg.RootDomain).First(&domain).Error
		if err == nil {
			d = &domain
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return OwnerInfo{}, false, err
		}
	}
	return OwnerForRecipient(db, msg.Recipient, d)
}

func OwnerForRecipient(db *gorm.DB, recipient string, d *models.Domain) (OwnerInfo, bool, error) {
	var mailbox models.Mailbox
	err := db.Where("email = ?", recipient).First(&mailbox).Error
	if err == nil {
		mailboxID := mailbox.ID
		domainID := mailbox.DomainID
		return OwnerInfo{
			OwnerID:   mailbox.OwnerID,
			Source:    OwnerSourceMailbox,
			MailboxID: &mailboxID,
			DomainID:  &domainID,
		}, true, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return OwnerInfo{}, false, err
	}
	if d != nil && d.Mode == models.DomainModePrivate && d.OwnerID != nil {
		domainID := d.ID
		return OwnerInfo{
			OwnerID:  *d.OwnerID,
			Source:   OwnerSourcePrivateDomain,
			DomainID: &domainID,
		}, true, nil
	}
	return OwnerInfo{}, false, nil
}

func ScopeOwnedMessages(db *gorm.DB, query *gorm.DB, ownerID uint) *gorm.DB {
	ownedMailboxes := db.Model(&models.Mailbox{}).
		Select("email").
		Where("owner_id = ?", ownerID)
	ownedPrivateDomains := db.Model(&models.Domain{}).
		Select("domain").
		Where("owner_id = ? AND mode = ?", ownerID, models.DomainModePrivate)

	return query.Where(
		"recipient IN (?) OR (root_domain IN (?) AND NOT EXISTS (SELECT 1 FROM mailboxes WHERE mailboxes.email = messages.recipient))",
		ownedMailboxes,
		ownedPrivateDomains,
	)
}

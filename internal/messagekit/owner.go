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
	if msg.OwnerID != nil {
		info := OwnerInfo{
			OwnerID:   *msg.OwnerID,
			MailboxID: msg.MailboxID,
			DomainID:  msg.DomainID,
		}
		if msg.MailboxID != nil {
			info.Source = OwnerSourceMailbox
		} else {
			info.Source = OwnerSourcePrivateDomain
		}
		return info, true, nil
	}
	return OwnerInfo{}, false, nil
}

func OwnerForRecipient(db *gorm.DB, recipient string, d *models.Domain) (OwnerInfo, bool, error) {
	var mailbox models.Mailbox
	err := db.Where("email = ?", recipient).First(&mailbox).Error
	if err == nil {
		if d == nil || mailbox.DomainID == d.ID {
			mailboxID := mailbox.ID
			domainID := mailbox.DomainID
			return OwnerInfo{
				OwnerID:   mailbox.OwnerID,
				Source:    OwnerSourceMailbox,
				MailboxID: &mailboxID,
				DomainID:  &domainID,
			}, true, nil
		}
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
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
	return query.Where("owner_id = ?", ownerID)
}

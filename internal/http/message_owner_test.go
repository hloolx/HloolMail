package httpapi

import (
	"testing"

	"gptmail/internal/models"
)

func TestMessageOwnerForRecipientPrefersExactMailbox(t *testing.T) {
	db := httpTestDB(t)
	domainOwner := models.User{Email: "domain-owner@example.com", PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	mailboxOwner := models.User{Email: "mailbox-owner@example.com", PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	if err := db.Create(&domainOwner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&mailboxOwner).Error; err != nil {
		t.Fatal(err)
	}
	privateDomain := models.Domain{
		Domain:     "private-owner.test",
		Mode:       models.DomainModePrivate,
		OwnerID:    &domainOwner.ID,
		Active:     true,
		MXVerified: true,
	}
	if err := db.Create(&privateDomain).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.Mailbox{
		OwnerID:   mailboxOwner.ID,
		Email:     "demo@private-owner.test",
		LocalPart: "demo",
		Host:      "private-owner.test",
		DomainID:  privateDomain.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	h := &Handler{DB: db}

	owner, exists, err := h.messageOwnerForRecipient("demo@private-owner.test", &privateDomain)
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatal("expected message owner")
	}
	if owner.OwnerID != mailboxOwner.ID || owner.Source != messageOwnerSourceMailbox {
		t.Fatalf("owner = %+v, want mailbox owner %d", owner, mailboxOwner.ID)
	}
	allowedMailboxOwner, err := h.actorOwnsMessageRecipient(&requestActor{User: &mailboxOwner}, "demo@private-owner.test", &privateDomain)
	if err != nil {
		t.Fatal(err)
	}
	if !allowedMailboxOwner {
		t.Fatal("expected exact mailbox owner to be allowed")
	}
	allowedDomainOwner, err := h.actorOwnsMessageRecipient(&requestActor{User: &domainOwner}, "demo@private-owner.test", &privateDomain)
	if err != nil {
		t.Fatal(err)
	}
	if allowedDomainOwner {
		t.Fatal("private domain owner should not override exact mailbox owner")
	}
}

func TestMessageOwnerForRecipientFallsBackToPrivateDomainOwner(t *testing.T) {
	db := httpTestDB(t)
	domainOwner := models.User{Email: "domain-owner@example.com", PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	other := models.User{Email: "other@example.com", PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	if err := db.Create(&domainOwner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	privateDomain := models.Domain{
		Domain:     "private-fallback.test",
		Mode:       models.DomainModePrivate,
		OwnerID:    &domainOwner.ID,
		Active:     true,
		MXVerified: true,
	}
	if err := db.Create(&privateDomain).Error; err != nil {
		t.Fatal(err)
	}
	h := &Handler{DB: db}

	owner, exists, err := h.messageOwnerForRecipient("random@private-fallback.test", &privateDomain)
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatal("expected private domain fallback owner")
	}
	if owner.OwnerID != domainOwner.ID || owner.Source != messageOwnerSourcePrivateDomain {
		t.Fatalf("owner = %+v, want private domain owner %d", owner, domainOwner.ID)
	}
	allowedDomainOwner, err := h.userOwnsMessageRecipient(&domainOwner, "random@private-fallback.test", &privateDomain)
	if err != nil {
		t.Fatal(err)
	}
	if !allowedDomainOwner {
		t.Fatal("expected private domain owner fallback to allow access")
	}
	allowedOther, err := h.userOwnsMessageRecipient(&other, "random@private-fallback.test", &privateDomain)
	if err != nil {
		t.Fatal(err)
	}
	if allowedOther {
		t.Fatal("other user should not access private domain fallback messages")
	}
}

func TestMessageOwnerForRecipientIgnoresMailboxFromDifferentResolvedDomain(t *testing.T) {
	db := httpTestDB(t)
	parentOwner := models.User{Email: "parent-owner@example.com", PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	childOwner := models.User{Email: "child-owner@example.com", PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	if err := db.Create(&parentOwner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&childOwner).Error; err != nil {
		t.Fatal(err)
	}
	parentDomain := models.Domain{
		Domain:            "wild-owner.test",
		Mode:              models.DomainModePrivate,
		OwnerID:           &parentOwner.ID,
		Active:            true,
		WildcardEnabled:   true,
		WildcardRequested: true,
	}
	childDomain := models.Domain{
		Domain:     "shop.wild-owner.test",
		Mode:       models.DomainModePrivate,
		OwnerID:    &childOwner.ID,
		Active:     true,
		MXVerified: true,
	}
	if err := db.Create(&parentDomain).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&childDomain).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.Mailbox{
		OwnerID:   parentOwner.ID,
		Email:     "demo@shop.wild-owner.test",
		LocalPart: "demo",
		Host:      "shop.wild-owner.test",
		DomainID:  parentDomain.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	h := &Handler{DB: db}

	owner, exists, err := h.messageOwnerForRecipient("demo@shop.wild-owner.test", &childDomain)
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatal("expected child private-domain fallback owner")
	}
	if owner.OwnerID != childOwner.ID || owner.Source != messageOwnerSourcePrivateDomain {
		t.Fatalf("owner = %+v, want child domain owner %d", owner, childOwner.ID)
	}
	allowedParent, err := h.actorOwnsMessageRecipient(&requestActor{User: &parentOwner}, "demo@shop.wild-owner.test", &childDomain)
	if err != nil {
		t.Fatal(err)
	}
	if allowedParent {
		t.Fatal("parent wildcard mailbox owner should not access exact child-domain recipient")
	}
	allowedChild, err := h.actorOwnsMessageRecipient(&requestActor{User: &childOwner}, "demo@shop.wild-owner.test", &childDomain)
	if err != nil {
		t.Fatal(err)
	}
	if !allowedChild {
		t.Fatal("child domain owner should access exact child-domain recipient")
	}
}

func TestMessageOwnerForRecipientDoesNotFallbackToPublicDomainOwner(t *testing.T) {
	db := httpTestDB(t)
	domainOwner := models.User{Email: "public-domain-owner@example.com", PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	mailboxOwner := models.User{Email: "mailbox-owner@example.com", PasswordHash: "hash", Role: models.UserRoleUser, Enabled: true}
	if err := db.Create(&domainOwner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&mailboxOwner).Error; err != nil {
		t.Fatal(err)
	}
	publicDomain := models.Domain{
		Domain:     "public-owned.test",
		Mode:       models.DomainModePublic,
		OwnerID:    &domainOwner.ID,
		Active:     true,
		MXVerified: true,
	}
	if err := db.Create(&publicDomain).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.Mailbox{
		OwnerID:   mailboxOwner.ID,
		Email:     "demo@public-owned.test",
		LocalPart: "demo",
		Host:      "public-owned.test",
		DomainID:  publicDomain.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	h := &Handler{DB: db}

	owner, exists, err := h.messageOwnerForRecipient("demo@public-owned.test", &publicDomain)
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatal("expected exact public mailbox owner")
	}
	if owner.OwnerID != mailboxOwner.ID || owner.Source != messageOwnerSourceMailbox {
		t.Fatalf("owner = %+v, want mailbox owner %d", owner, mailboxOwner.ID)
	}
	allowedDomainOwner, err := h.actorOwnsMessageRecipient(&requestActor{User: &domainOwner}, "demo@public-owned.test", &publicDomain)
	if err != nil {
		t.Fatal(err)
	}
	if allowedDomainOwner {
		t.Fatal("public domain owner should not receive another user's mailbox messages")
	}
	allowedMailboxOwner, err := h.actorOwnsMessageRecipient(&requestActor{User: &mailboxOwner}, "demo@public-owned.test", &publicDomain)
	if err != nil {
		t.Fatal(err)
	}
	if !allowedMailboxOwner {
		t.Fatal("expected exact public mailbox owner to be allowed")
	}
	_, fallbackExists, err := h.messageOwnerForRecipient("random@public-owned.test", &publicDomain)
	if err != nil {
		t.Fatal(err)
	}
	if fallbackExists {
		t.Fatal("public domain owner should not be a fallback message owner")
	}
}

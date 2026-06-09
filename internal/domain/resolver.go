package domain

import (
	"errors"
	"fmt"
	"net/mail"
	"strings"

	"gptmail/internal/models"

	"golang.org/x/net/publicsuffix"
	"gorm.io/gorm"
)

var ErrDomainNotFound = errors.New("recipient domain not found")

type Resolver struct {
	DB *gorm.DB
}

type RecipientParts struct {
	Recipient string
	Local     string
	Host      string
}

func NormalizeRecipient(recipient string) (RecipientParts, error) {
	value := strings.TrimSpace(strings.ToLower(recipient))
	if start := strings.LastIndex(value, "<"); start >= 0 {
		if end := strings.LastIndex(value, ">"); end > start {
			value = strings.TrimSpace(value[start+1 : end])
		}
	}
	value = strings.Trim(value, "<>")
	if parsed, err := mail.ParseAddress(value); err == nil {
		value = strings.ToLower(strings.TrimSpace(parsed.Address))
	}
	at := strings.LastIndex(value, "@")
	if at <= 0 || at == len(value)-1 {
		return RecipientParts{}, fmt.Errorf("invalid recipient %q", recipient)
	}
	local := strings.TrimSpace(value[:at])
	host := strings.Trim(strings.TrimSpace(value[at+1:]), ".")
	if local == "" || host == "" || strings.ContainsAny(host, " /\\<>*") {
		return RecipientParts{}, fmt.Errorf("invalid recipient %q", recipient)
	}
	return RecipientParts{Recipient: local + "@" + host, Local: local, Host: host}, nil
}

func NormalizeDomain(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.TrimPrefix(value, "*.")
	value = strings.TrimPrefix(value, "*")
	value = strings.Trim(value, ".")
	return value
}

func (r Resolver) ResolveDomain(recipient string) (*models.Domain, error) {
	parts, err := NormalizeRecipient(recipient)
	if err != nil {
		return nil, err
	}
	var exact models.Domain
	if err := r.DB.Where("domain = ?", parts.Host).First(&exact).Error; err == nil {
		if exact.IsRootMailboxReady() {
			return &exact, nil
		}
		return nil, ErrDomainNotFound
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	for _, candidate := range wildcardCandidates(parts.Host) {
		var d models.Domain
		err := r.DB.Where("domain = ?", candidate).First(&d).Error
		if err == nil {
			if d.IsWildcardReady() {
				return &d, nil
			}
			return nil, ErrDomainNotFound
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}
	return nil, ErrDomainNotFound
}

func (r Resolver) ResolveDomainByHost(host string) (*models.Domain, error) {
	return r.ResolveDomain("probe@" + NormalizeDomain(host))
}

func wildcardCandidates(host string) []string {
	root, err := publicsuffix.EffectiveTLDPlusOne(host)
	if err != nil {
		return nil
	}
	labels := strings.Split(host, ".")
	rootLabels := strings.Split(root, ".")
	firstRootLabel := len(labels) - len(rootLabels)
	if firstRootLabel <= 0 {
		return nil
	}
	candidates := make([]string, 0, firstRootLabel)
	for i := 1; i <= firstRootLabel; i++ {
		candidates = append(candidates, strings.Join(labels[i:], "."))
	}
	return candidates
}

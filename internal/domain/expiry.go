package domain

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type rdapDomainResponse struct {
	Events []struct {
		EventAction string `json:"eventAction"`
		EventDate   string `json:"eventDate"`
	} `json:"events"`
}

func LookupDomainExpiry(ctx context.Context, domainName string) (*time.Time, error) {
	domainName = NormalizeDomain(domainName)
	if domainName == "" || strings.HasSuffix(domainName, ".test") || strings.HasSuffix(domainName, ".local") {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	requestURL := rdapDomainURL(domainName)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("rdap status %d", response.StatusCode)
	}

	var payload rdapDomainResponse
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&payload); err != nil { // 1 MB limit
		return nil, err
	}
	for _, event := range payload.Events {
		action := strings.ToLower(event.EventAction)
		if !strings.Contains(action, "expiration") && action != "expiry" && action != "expires" {
			continue
		}
		parsed, err := time.Parse(time.RFC3339, event.EventDate)
		if err != nil {
			continue
		}
		return &parsed, nil
	}
	return nil, nil
}

func rdapDomainURL(domainName string) string {
	u := url.URL{
		Scheme:  "https",
		Host:    "rdap.org",
		Path:    "/domain/" + domainName,
		RawPath: "/domain/" + url.PathEscape(domainName),
	}
	return u.String()
}

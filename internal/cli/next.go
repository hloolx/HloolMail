package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type NextEmailData struct {
	HasEmail bool           `json:"has_email"`
	Message  map[string]any `json:"message"`
}

type NextEmailResult struct {
	Response *APIResponse    `json:"-"`
	Data     NextEmailData   `json:"data"`
	Code     string          `json:"code,omitempty"`
	Attempts int             `json:"attempts"`
	RawData  json.RawMessage `json:"-"`
}

func WaitForNextEmail(ctx context.Context, client APIClient, email string, wait, interval time.Duration, codePattern string, sleep func(context.Context, time.Duration) error) (*NextEmailResult, error) {
	if strings.TrimSpace(email) == "" {
		return nil, &ExitError{Code: ExitConfig, Message: "email is required"}
	}
	if interval <= 0 {
		interval = 3 * time.Second
	}
	var codeRE *regexp.Regexp
	if strings.TrimSpace(codePattern) != "" {
		compiled, err := compileCodeRegex(codePattern)
		if err != nil {
			return nil, &ExitError{Code: ExitConfig, Message: err.Error()}
		}
		codeRE = compiled
	}
	deadline := time.Time{}
	if wait > 0 {
		deadline = time.Now().Add(wait)
	}
	attempts := 0
	for {
		attempts++
		resp, data, err := nextEmailOnce(ctx, client, email)
		if err != nil {
			return nil, err
		}
		result := &NextEmailResult{
			Response: resp,
			Data:     data,
			Attempts: attempts,
			RawData:  resp.dataRaw(),
		}
		if data.HasEmail {
			if codeRE != nil {
				result.Code = extractCode(data, codeRE)
			}
			return result, nil
		}
		if wait <= 0 {
			return result, nil
		}
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return nil, &ExitError{Code: ExitWaitTimeout, Message: "wait timed out with no email"}
		}
		nap := interval
		if nap > remaining {
			nap = remaining
		}
		if sleep == nil {
			sleep = sleepContext
		}
		if err := sleep(ctx, nap); err != nil {
			return nil, &ExitError{Code: ExitWaitTimeout, Message: "wait timed out with no email"}
		}
	}
}

func nextEmailOnce(ctx context.Context, client APIClient, email string) (*APIResponse, NextEmailData, error) {
	query := url.Values{"email": []string{email}}
	resp, err := client.Do(ctx, http.MethodGet, "/api/emails/next", query, nil)
	if err != nil {
		return resp, NextEmailData{}, err
	}
	var data NextEmailData
	if err := decodeEnvelopeData(resp, &data); err != nil {
		return resp, data, &ExitError{Code: ExitServer, Message: fmt.Sprintf("invalid next email response: %v", err)}
	}
	return resp, data, nil
}

func sleepContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func compileCodeRegex(pattern string) (*regexp.Regexp, error) {
	normalized := strings.ReplaceAll(pattern, `\d`, `[0-9]`)
	re, err := regexp.Compile(normalized)
	if err != nil {
		return nil, fmt.Errorf("invalid code-regex: %w", err)
	}
	return re, nil
}

func extractCode(data NextEmailData, re *regexp.Regexp) string {
	if re == nil || data.Message == nil {
		return ""
	}
	fields := []string{"text_content", "html_content", "subject"}
	for _, field := range fields {
		if value, ok := data.Message[field].(string); ok {
			if match := re.FindString(value); match != "" {
				return match
			}
		}
	}
	for _, value := range data.Message {
		text, ok := value.(string)
		if !ok {
			continue
		}
		if match := re.FindString(text); match != "" {
			return match
		}
	}
	return ""
}

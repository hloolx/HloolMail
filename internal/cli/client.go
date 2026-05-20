package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type APIClient struct {
	BaseURL    string
	APIKey     string
	HTTPClient *http.Client
	Timeout    time.Duration
}

type APIResponse struct {
	StatusCode  int
	Header      http.Header
	Body        []byte
	ContentType string
	Envelope    *Envelope
}

type Envelope struct {
	Success bool              `json:"success"`
	Data    json.RawMessage   `json:"data"`
	Error   json.RawMessage   `json:"error"`
	Usage   map[string]string `json:"usage,omitempty"`
}

func (c APIClient) Do(ctx context.Context, method, path string, query url.Values, body any) (*APIResponse, error) {
	if c.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.Timeout)
		defer cancel()
	}
	target, err := c.url(path, query)
	if err != nil {
		return nil, &ExitError{Code: ExitConfig, Message: err.Error()}
	}
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, &ExitError{Code: ExitConfig, Message: err.Error()}
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		return nil, &ExitError{Code: ExitConfig, Message: err.Error()}
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(c.APIKey) != "" {
		req.Header.Set("X-API-Key", strings.TrimSpace(c.APIKey))
	}
	client := c.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, networkExitError(err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, networkExitError(err)
	}
	result := &APIResponse{
		StatusCode:  resp.StatusCode,
		Header:      resp.Header.Clone(),
		Body:        data,
		ContentType: resp.Header.Get("Content-Type"),
	}
	if strings.Contains(result.ContentType, "application/json") || json.Valid(data) {
		var envelope Envelope
		if err := json.Unmarshal(data, &envelope); err == nil {
			result.Envelope = &envelope
		}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return result, &ExitError{
			Code:       mapHTTPStatusToExitCode(resp.StatusCode, result.errorMessage()),
			Message:    result.errorMessage(),
			StatusCode: resp.StatusCode,
			Raw:        data,
		}
	}
	if result.Envelope != nil && !result.Envelope.Success {
		return result, &ExitError{
			Code:       mapHTTPStatusToExitCode(resp.StatusCode, result.errorMessage()),
			Message:    result.errorMessage(),
			StatusCode: resp.StatusCode,
			Raw:        data,
		}
	}
	return result, nil
}

func (c APIClient) url(path string, query url.Values) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(c.BaseURL), "/")
	if base == "" {
		base = defaultBaseURL
	}
	if _, err := url.ParseRequestURI(base); err != nil {
		return "", fmt.Errorf("invalid base_url: %w", err)
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	target := base + path
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	return target, nil
}

func (r *APIResponse) dataRaw() json.RawMessage {
	if r == nil || r.Envelope == nil {
		return nil
	}
	return r.Envelope.Data
}

func (r *APIResponse) errorMessage() string {
	if r == nil {
		return "request failed"
	}
	if r.Envelope == nil {
		if len(strings.TrimSpace(string(r.Body))) > 0 {
			return strings.TrimSpace(string(r.Body))
		}
		return http.StatusText(r.StatusCode)
	}
	if len(r.Envelope.Error) == 0 || string(r.Envelope.Error) == "null" {
		return http.StatusText(r.StatusCode)
	}
	var text string
	if err := json.Unmarshal(r.Envelope.Error, &text); err == nil {
		return text
	}
	return strings.TrimSpace(string(r.Envelope.Error))
}

func decodeEnvelopeData(resp *APIResponse, target any) error {
	raw := resp.dataRaw()
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	return json.Unmarshal(raw, target)
}

func networkExitError(err error) *ExitError {
	code := ExitNetwork
	message := err.Error()
	if errors.Is(err, context.DeadlineExceeded) {
		message = "request timed out"
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		message = "request timed out"
	}
	return &ExitError{Code: code, Message: message}
}

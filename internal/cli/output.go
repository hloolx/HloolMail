package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"
)

type StandardResult struct {
	OK      bool              `json:"ok"`
	Command string            `json:"command,omitempty"`
	Data    any               `json:"data,omitempty"`
	Error   any               `json:"error,omitempty"`
	Usage   map[string]string `json:"usage,omitempty"`
}

type StandardError struct {
	Message  string `json:"message"`
	Status   int    `json:"status,omitempty"`
	ExitCode int    `json:"exit_code"`
}

type humanPrinter func(io.Writer, json.RawMessage) error

func writeAPIResult(w io.Writer, cfg ResolvedConfig, command string, resp *APIResponse, quiet string, human humanPrinter) error {
	switch strings.ToLower(cfg.Output) {
	case "raw":
		if resp != nil {
			_, err := w.Write(appendNewline(resp.Body))
			return err
		}
	case "json":
		var data any
		if raw := resp.dataRaw(); len(raw) > 0 && string(raw) != "null" {
			if err := json.Unmarshal(raw, &data); err != nil {
				return err
			}
		}
		result := StandardResult{OK: true, Command: command, Data: data}
		if resp != nil && resp.Envelope != nil {
			result.Usage = resp.Envelope.Usage
		}
		return writeJSON(w, result)
	case "quiet":
		if quiet != "" {
			_, err := fmt.Fprintln(w, quiet)
			return err
		}
		return nil
	default:
		if human != nil {
			return human(w, resp.dataRaw())
		}
		return writeIndentedJSON(w, resp.dataRaw())
	}
	return nil
}

func writeLocalResult(w io.Writer, cfg ResolvedConfig, command string, data any, raw []byte, quiet string, human func(io.Writer) error) error {
	switch strings.ToLower(cfg.Output) {
	case "raw":
		if raw != nil {
			_, err := w.Write(appendNewline(raw))
			return err
		}
		return writeJSON(w, data)
	case "json":
		return writeJSON(w, StandardResult{OK: true, Command: command, Data: data})
	case "quiet":
		if quiet != "" {
			_, err := fmt.Fprintln(w, quiet)
			return err
		}
		return nil
	default:
		if human != nil {
			return human(w)
		}
		return writeJSON(w, data)
	}
}

func writeError(w io.Writer, mode string, err *ExitError) {
	if err == nil {
		return
	}
	switch strings.ToLower(mode) {
	case "json":
		_ = writeJSON(w, StandardResult{
			OK:    false,
			Error: StandardError{Message: err.Message, Status: err.StatusCode, ExitCode: err.Code},
		})
	case "raw":
		if len(err.Raw) > 0 {
			_, _ = w.Write(appendNewline(err.Raw))
			return
		}
		_, _ = fmt.Fprintln(w, err.Message)
	default:
		if strings.TrimSpace(err.Message) != "" {
			_, _ = fmt.Fprintln(w, err.Message)
		}
	}
}

func writeJSON(w io.Writer, value any) error {
	encoder := json.NewEncoder(w)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func writeIndentedJSON(w io.Writer, raw json.RawMessage) error {
	if len(raw) == 0 {
		_, err := fmt.Fprintln(w, "null")
		return err
	}
	var data any
	if err := json.Unmarshal(raw, &data); err != nil {
		_, writeErr := w.Write(appendNewline(raw))
		return writeErr
	}
	return writeJSON(w, data)
}

func appendNewline(data []byte) []byte {
	if len(data) == 0 || data[len(data)-1] == '\n' {
		return data
	}
	out := make([]byte, 0, len(data)+1)
	out = append(out, data...)
	out = append(out, '\n')
	return out
}

func printMap(w io.Writer, data map[string]any) error {
	keys := make([]string, 0, len(data))
	for key := range data {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if _, err := fmt.Fprintf(w, "%s: %v\n", key, data[key]); err != nil {
			return err
		}
	}
	return nil
}

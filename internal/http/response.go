package httpapi

import (
	"log/slog"
	"net/http"

	"gptmail/internal/auth"
	"gptmail/internal/models"

	"github.com/gin-gonic/gin"
)

const apiKeyContext = "api_key"
const internalErrorMessage = "internal server error"

type envelope struct {
	Success bool              `json:"success"`
	Data    any               `json:"data"`
	Error   any               `json:"error"`
	Usage   map[string]string `json:"usage,omitempty"`
}

func ok(c *gin.Context, data any) {
	writeJSON(c, http.StatusOK, data)
}

func publicOK(c *gin.Context, data any) {
	writeJSON(c, http.StatusOK, data)
}

func webOK(c *gin.Context, data any) {
	writeJSON(c, http.StatusOK, data)
}

func respond(c *gin.Context, publicData, webData any) {
	if currentAPIKey(c) != nil {
		publicOK(c, publicData)
		return
	}
	webOK(c, webData)
}

func writeJSON(c *gin.Context, status int, data any) {
	c.JSON(status, envelope{
		Success: true,
		Data:    data,
		Error:   nil,
		Usage:   usage(c),
	})
}

func created(c *gin.Context, data any) {
	writeJSON(c, http.StatusCreated, data)
}

func fail(c *gin.Context, status int, message string) {
	if status >= http.StatusInternalServerError {
		logInternalHTTPError(c, status, message)
		message = publicServerErrorMessage(status)
	}
	c.JSON(status, envelope{
		Success: false,
		Data:    nil,
		Error:   message,
		Usage:   usage(c),
	})
}

func publicServerErrorMessage(status int) string {
	if message := http.StatusText(status); message != "" {
		return message
	}
	return internalErrorMessage
}

func logInternalHTTPError(c *gin.Context, status int, message string) {
	method := ""
	path := ""
	if c != nil && c.Request != nil {
		method = c.Request.Method
		if c.Request.URL != nil {
			path = c.Request.URL.RequestURI()
		}
	}
	slog.Error("http 5xx response redacted", "status", status, "method", method, "path", path, "error", message, "request_id", requestID(c))
}

func usage(c *gin.Context) map[string]string {
	value, exists := c.Get(apiKeyContext)
	if !exists {
		return nil
	}
	key, _ := value.(*models.APIKey)
	values := auth.UsageFor(key)
	if len(values) == 0 {
		return nil
	}
	return values
}

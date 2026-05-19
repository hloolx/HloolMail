package httpapi

import (
	"net/http"

	"gptmail/internal/auth"
	"gptmail/internal/models"

	"github.com/gin-gonic/gin"
)

const apiKeyContext = "api_key"

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
	c.JSON(status, envelope{
		Success: false,
		Data:    nil,
		Error:   message,
		Usage:   usage(c),
	})
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

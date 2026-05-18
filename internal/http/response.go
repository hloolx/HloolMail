package httpapi

import (
	"net/http"
	"strconv"

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
	c.JSON(http.StatusOK, envelope{
		Success: true,
		Data:    data,
		Error:   nil,
		Usage:   usage(c),
	})
}

func created(c *gin.Context, data any) {
	c.JSON(http.StatusCreated, envelope{
		Success: true,
		Data:    data,
		Error:   nil,
		Usage:   usage(c),
	})
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
	formatted := make(map[string]string, len(values))
	for name, value := range values {
		formatted[name] = strconv.FormatInt(value, 10)
	}
	return formatted
}

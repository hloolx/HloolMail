package httpapi

import (
	"net/http"
	"strings"

	"gptmail/internal/apispec"
	"gptmail/internal/version"

	"github.com/gin-gonic/gin"
)

func (h *Handler) apiDocsMarkdown(c *gin.Context) {
	docs := apispec.Markdown(h.apiSpecConfig(c))
	c.Header("Content-Disposition", `inline; filename="hlool-mail-api-docs.md"`)
	c.Data(http.StatusOK, "text/markdown; charset=utf-8", []byte(docs))
}

func (h *Handler) apiSkillMarkdown(c *gin.Context) {
	skill := apispec.SkillMarkdown(h.apiSpecConfig(c))
	c.Header("Content-Disposition", `inline; filename="hlool-mail-api-skill.md"`)
	c.Data(http.StatusOK, "text/markdown; charset=utf-8", []byte(skill))
}

func (h *Handler) openAPIJSON(c *gin.Context) {
	data, err := apispec.JSON(h.apiSpecConfig(c))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.Header("Content-Disposition", `inline; filename="hlool-mail-openapi.json"`)
	c.Data(http.StatusOK, "application/json; charset=utf-8", data)
}

func (h *Handler) openAPIYAML(c *gin.Context) {
	data, err := apispec.YAML(h.apiSpecConfig(c))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.Header("Content-Disposition", `inline; filename="hlool-mail-openapi.yaml"`)
	c.Data(http.StatusOK, "application/yaml; charset=utf-8", data)
}

func (h *Handler) apiSpecConfig(c *gin.Context) apispec.Config {
	baseURL := strings.TrimRight(h.Config.PublicBaseURL, "/")
	if baseURL == "" {
		baseURL = requestBaseURL(c)
	}
	return apispec.Config{
		BaseURL:    baseURL,
		ExpectedMX: h.Config.ExpectedMX,
		Version:    version.Version,
	}
}

func requestBaseURL(c *gin.Context) string {
	scheme := "http"
	if c.Request.TLS != nil {
		scheme = "https"
	}
	if forwarded := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")); forwarded != "" {
		scheme = strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}

	host := strings.TrimSpace(c.GetHeader("X-Forwarded-Host"))
	if host == "" {
		host = c.Request.Host
	}
	return scheme + "://" + host
}

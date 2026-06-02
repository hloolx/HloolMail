package httpapi

import (
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gptmail/internal/auth"
	"gptmail/internal/config"
	"gptmail/internal/domain"
	"gptmail/internal/emaildelivery"
	"gptmail/internal/events"
	"gptmail/internal/frontend"
	"gptmail/internal/jobs"
	"gptmail/internal/mailer"
)

type noDirFS struct {
	fs http.FileSystem
}

func (nfs noDirFS) Open(name string) (http.File, error) {
	f, err := nfs.fs.Open(name)
	if err != nil {
		return nil, err
	}
	stat, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	if stat.IsDir() {
		f.Close()
		return nil, os.ErrNotExist
	}
	return f, nil
}

type Handler struct {
	Config       config.Config
	DB           *gorm.DB
	Resolver     domain.Resolver
	DNSChecker   domain.DNSChecker
	APIKeys      auth.APIKeyService
	Sessions     auth.SessionService
	Hub          *events.Hub
	DomainHealth *jobs.DomainHealthJob
	RateLimiter  *rateLimiter
	AuditLogger  *AuditLogger
	Mailer       mailer.Sender
	EmailWorker  *emaildelivery.Worker

	rateLimiterOnce sync.Once
}

func NewRouter(h *Handler) *gin.Engine {
	if h.Config.DevMode {
		gin.SetMode(gin.DebugMode)
	} else {
		gin.SetMode(gin.ReleaseMode)
	}
	router := gin.New()
	router.Use(gin.Recovery(), h.securityHeaders(), h.cors(), h.loadSession(), h.optionalAPIKey(), h.requireSameOriginSessionWrite())

	router.GET("/robots.txt", h.perIPRateLimit(1, 10), h.robotsTXT)
	router.GET("/sitemap.xml", h.perIPRateLimit(1, 10), h.sitemapXML)

	api := router.Group("/api")
	api.GET("/health", h.perIPRateLimit(2, 5), h.health)
	api.GET("/version", h.perIPRateLimit(0.5, 5), h.versionInfo)
	api.GET("/version/check", h.perIPRateLimit(1.0/12, 2), h.versionCheck)
	api.GET("/auth/login-settings", h.perIPRateLimit(1, 10), h.loginSettings)
	api.GET("/install/status", h.perIPRateLimit(1.0/3, 3), h.installStatus)
	api.POST("/install/dns-check", h.perIPRateLimit(1.0/6, 3), h.installDNSCheck)
	api.POST("/install", h.perIPRateLimit(1.0/3, 3), h.install)
	api.POST("/auth/login", h.perIPRateLimit(1.0/3, 5), h.login)
	api.POST("/auth/passkeys/login/start", h.perIPRateLimit(1.0/3, 5), h.beginPasskeyLogin)
	api.POST("/auth/passkeys/login/finish", h.perIPRateLimit(1.0/3, 5), h.finishPasskeyLogin)
	api.POST("/auth/register/captcha", h.perIPRateLimit(1.0/3, 5), h.registrationCaptcha)
	api.POST("/auth/register", h.perIPRateLimit(1.0/3, 5), h.register)
	api.POST("/auth/register/verify", h.perIPRateLimit(1.0/3, 5), h.verifyRegistration)
	api.GET("/email-deliveries/:id", h.perIPRateLimit(2, 10), h.getEmailDelivery)
	api.GET("/oauth/providers", h.perIPRateLimit(1, 10), h.listOAuthProviders)
	api.GET("/oauth/:provider/login", h.perIPRateLimit(1.0/3, 5), h.oauthRedirect)
	api.GET("/oauth/:provider/callback", h.perIPRateLimit(1, 10), h.oauthCallback)
	api.GET("/docs.md", h.perIPRateLimit(0.5, 2), h.apiDocsMarkdown)
	api.GET("/skill.md", h.perIPRateLimit(0.5, 2), h.apiSkillMarkdown)
	api.GET("/openapi.json", h.perIPRateLimit(0.5, 2), h.openAPIJSON)
	api.GET("/openapi.yaml", h.perIPRateLimit(0.5, 2), h.openAPIYAML)
	api.GET("/shared/:token", h.perIPRateLimit(2, 10), h.getSharedLink)
	api.GET("/shared/:token/messages", h.perIPRateLimit(2, 10), h.listSharedMailboxMessages)
	api.GET("/shared/:token/messages/:message_id", h.perIPRateLimit(2, 10), h.getSharedMailboxMessage)

	authAPI := api.Group("", h.perAPIRateLimit(2, 10))
	authAPI.POST("/auth/logout", h.logout)
	authAPI.GET("/auth/me", h.me)
	authAPI.PATCH("/user/profile", h.patchUserProfile)
	authAPI.GET("/user/onboarding", h.getUserOnboarding)
	authAPI.PATCH("/user/onboarding", h.patchUserOnboarding)
	authAPI.GET("/user/oauth-identities", h.listUserOAuthIdentities)
	authAPI.DELETE("/user/oauth-identities/:provider", h.unbindUserOAuthIdentity)
	authAPI.GET("/user/passkeys", h.listUserPasskeys)
	authAPI.POST("/user/passkeys/register/start", h.beginPasskeyRegistration)
	authAPI.POST("/user/passkeys/register/finish", h.finishPasskeyRegistration)
	authAPI.DELETE("/user/passkeys/:id", h.deleteUserPasskey)
	authAPI.GET("/stats", h.stats)
	authAPI.GET("/stats/timeseries", h.statsTimeseries)

	mailGroup := api.Group("", h.perAPIRateLimit(2, 20))
	mailGroup.GET("/emails", h.listEmails)
	mailGroup.GET("/emails/next", h.nextEmail)
	mailGroup.GET("/email/:id", h.getEmail)
	mailGroup.PATCH("/email/:id/read", h.markEmailRead)
	mailGroup.DELETE("/email/:id", h.deleteEmail)
	mailGroup.DELETE("/emails/clear", h.clearEmails)
	mailGroup.GET("/mailboxes", h.listMailboxes)
	mailGroup.GET("/mailboxes/stats", h.mailboxStats)
	mailGroup.DELETE("/mailboxes/:id", h.deleteMailbox)
	api.GET("/inbox-stream", h.perAPIRateLimit(1.0/6, 3), h.inboxStream)

	api.POST("/generate-email", h.perAPIRateLimit(1, 10), h.generateEmail)

	domainGroup := api.Group("", h.perAPIRateLimit(0.5, 5))
	domainGroup.POST("/domains/request", h.requestDomain)
	domainGroup.POST("/domains/batch-request", h.batchRequestDomain)
	domainGroup.POST("/domains/check-mx", h.perAPIRateLimit(1.0/6, 2), h.checkMX)
	domainGroup.GET("/domains", h.listDomains)
	domainGroup.GET("/domains/available", h.availableDomains)
	domainGroup.GET("/domains/:id", h.getDomain)
	domainGroup.PATCH("/domains/:id", h.patchDomain)
	domainGroup.POST("/domains/:id/mx-auto-retry", h.setDomainMXAutoRetry)
	domainGroup.DELETE("/domains/:id", h.deleteDomain)

	apiKeyGroup := api.Group("", h.perAPIRateLimit(0.5, 5))
	apiKeyGroup.GET("/api-keys", h.listAPIKeys)
	apiKeyGroup.POST("/api-keys", h.createAPIKey)
	apiKeyGroup.PATCH("/api-keys/:id", h.patchAPIKey)
	apiKeyGroup.DELETE("/api-keys/:id", h.deleteAPIKey)
	apiKeyGroup.POST("/api-keys/:id/reveal", h.revealAPIKey)

	shareLinkGroup := api.Group("", h.perAPIRateLimit(0.5, 5))
	shareLinkGroup.POST("/share-links", h.createShareLink)
	shareLinkGroup.GET("/share-links", h.listShareLinks)
	shareLinkGroup.GET("/share-links/:id", h.getShareLink)
	shareLinkGroup.PATCH("/share-links/:id", h.patchShareLink)
	shareLinkGroup.DELETE("/share-links/:id", h.deleteShareLink)
	shareLinkGroup.POST("/share-links/:id/revoke", h.revokeShareLink)
	shareLinkGroup.POST("/share-links/:id/rotate-token", h.rotateShareLinkToken)
	shareLinkGroup.POST("/share-links/:id/rotate-key", h.rotateShareLinkKey)
	shareLinkGroup.GET("/share-links/:id/access-logs", h.listShareLinkAccessLogs)

	webhookGroup := api.Group("", h.perAPIRateLimit(0.5, 5))
	webhookGroup.GET("/webhooks", h.listWebhooks)
	webhookGroup.POST("/webhooks", h.createWebhook)
	webhookGroup.PATCH("/webhooks/:id", h.patchWebhook)
	webhookGroup.DELETE("/webhooks/:id", h.deleteWebhook)
	webhookGroup.POST("/webhooks/:id/rotate-secret", h.rotateWebhookSecret)
	webhookGroup.POST("/webhooks/:id/test", h.testWebhook)
	webhookGroup.GET("/webhooks/:id/deliveries", h.listWebhookDeliveries)

	notificationGroup := api.Group("", h.perAPIRateLimit(0.5, 5))
	notificationGroup.GET("/notifications", h.listNotifications)
	notificationGroup.GET("/notifications/unread-count", h.unreadNotificationCount)
	notificationGroup.PATCH("/notifications/:id/read", h.markNotificationRead)
	notificationGroup.POST("/notifications/read-all", h.markAllNotificationsRead)
	api.GET("/notification-stream", h.perAPIRateLimit(1.0/6, 3), h.notificationStream)

	announcementGroup := api.Group("", h.perAPIRateLimit(0.5, 5))
	announcementGroup.GET("/announcements", h.listAnnouncements)
	announcementGroup.GET("/announcements/unread-count", h.unreadAnnouncementCount)
	announcementGroup.PATCH("/announcements/:id/read", h.markAnnouncementRead)
	api.GET("/announcement-stream", h.perAPIRateLimit(1.0/6, 3), h.announcementStream)

	adminGroup := api.Group("", h.perAPIRateLimit(0.5, 5), h.requireAdminSessionMiddleware())
	adminGroup.GET("/admin/stats", h.adminStats)
	adminGroup.GET("/admin/stats/timeseries", h.adminStatsTimeseries)
	adminGroup.GET("/admin/users", h.listUsers)
	adminGroup.POST("/admin/users", h.createUser)
	adminGroup.GET("/admin/users/:id/api-keys", h.listUserAPIKeys)
	adminGroup.POST("/admin/users/:id/api-keys/:key_id/reveal", h.revealUserAPIKey)
	adminGroup.PATCH("/admin/users/:id", h.patchUser)
	adminGroup.DELETE("/admin/users/:id", h.deleteUser)
	adminGroup.GET("/admin/domain-health", h.adminDomainHealth)
	adminGroup.POST("/admin/domains/:id/check-mx", h.adminCheckDomainMX)
	adminGroup.PATCH("/admin/domains/:id", h.patchAdminDomain)
	adminGroup.DELETE("/admin/domains/:id", h.deleteAdminDomain)
	adminGroup.GET("/admin/domain-check-settings", h.adminDomainCheckSettings)
	adminGroup.PATCH("/admin/domain-check-settings", h.patchAdminDomainCheckSettings)
	adminGroup.POST("/admin/domain-check-runs", h.createAdminDomainCheckRun)
	adminGroup.GET("/admin/domain-check-runs", h.listAdminDomainCheckRuns)
	adminGroup.GET("/admin/domain-check-runs/:id", h.getAdminDomainCheckRun)
	adminGroup.GET("/admin/oauth/providers", h.adminListOAuthProviders)
	adminGroup.PATCH("/admin/oauth/providers/:provider", h.adminUpdateOAuthProvider)
	adminGroup.GET("/admin/quota-alerts", h.adminQuotaAlerts)
	adminGroup.GET("/admin/login-settings", h.adminLoginSettings)
	adminGroup.PATCH("/admin/login-settings", h.patchAdminLoginSettings)
	adminGroup.POST("/admin/login-settings/test-email", h.testAdminLoginSettingsEmail)
	adminGroup.GET("/admin/quota-settings", h.adminQuotaSettings)
	adminGroup.PATCH("/admin/quota-settings", h.patchAdminQuotaSettings)
	adminGroup.GET("/admin/share-links", h.listAdminShareLinks)
	adminGroup.POST("/admin/share-links/:id/revoke", h.revokeAdminShareLink)
	adminGroup.DELETE("/admin/share-links/:id", h.deleteAdminShareLink)
	adminGroup.GET("/admin/share-links/:id/access-logs", h.listAdminShareLinkAccessLogs)
	adminGroup.GET("/admin/webhooks", h.listAdminWebhooks)
	adminGroup.POST("/admin/webhooks/:id/disable", h.disableAdminWebhook)
	adminGroup.DELETE("/admin/webhooks/:id", h.deleteAdminWebhook)
	adminGroup.GET("/admin/webhooks/:id/deliveries", h.listAdminWebhookDeliveries)
	adminGroup.GET("/admin/audit-logs", h.adminAuditLogs)
	adminGroup.GET("/admin/announcements", h.adminListAnnouncements)
	adminGroup.POST("/admin/announcements", h.adminCreateAnnouncement)
	adminGroup.DELETE("/admin/announcements/:id", h.adminDeleteAnnouncement)

	embeddedFrontend, hasEmbeddedFrontend := frontend.Embedded()
	mountFrontend(router, h.Config.FrontendDist, embeddedFrontend, hasEmbeddedFrontend)
	return router
}

func mountFrontend(router *gin.Engine, dist string, embedded fs.FS, hasEmbedded bool) {
	if mountFrontendDir(router, dist) {
		return
	}
	if hasEmbedded && mountFrontendFS(router, embedded) {
		return
	}
	router.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, envelope{Success: false, Data: nil, Error: "not found", Usage: usage(c)})
	})
}

func mountFrontendDir(router *gin.Engine, dist string) bool {
	index := filepath.Join(dist, "index.html")
	if _, err := os.Stat(index); err != nil {
		return false
	}
	assets := filepath.Join(dist, "assets")
	if _, err := os.Stat(assets); err == nil {
		router.StaticFS("/assets", noDirFS{http.Dir(assets)})
	}
	router.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			apiRouteNotFound(c)
			return
		}
		requestPath := strings.TrimPrefix(c.Request.URL.Path, "/")
		if requestPath != "" {
			relativePath := filepath.Clean(requestPath)
			if filepath.IsLocal(relativePath) {
				staticFile := filepath.Join(dist, relativePath)
				if info, err := os.Stat(staticFile); err == nil && !info.IsDir() {
					c.File(staticFile)
					return
				}
			}
		}
		c.File(index)
	})
	return true
}

func mountFrontendFS(router *gin.Engine, embedded fs.FS) bool {
	if _, err := fs.Stat(embedded, "index.html"); err != nil {
		return false
	}
	if _, err := fs.Stat(embedded, "assets"); err == nil {
		if assets, subErr := fs.Sub(embedded, "assets"); subErr == nil {
			router.StaticFS("/assets", noDirFS{http.FS(assets)})
		}
	}
	frontendFiles := noDirFS{http.FS(embedded)}
	router.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			apiRouteNotFound(c)
			return
		}
		requestPath := strings.TrimPrefix(c.Request.URL.Path, "/")
		if requestPath != "" {
			relativePath := path.Clean(requestPath)
			if fs.ValidPath(relativePath) {
				if info, err := fs.Stat(embedded, relativePath); err == nil && !info.IsDir() {
					serveFrontendFSFile(c, frontendFiles, relativePath)
					return
				}
			}
		}
		serveFrontendFSFile(c, frontendFiles, "index.html")
	})
	return true
}

func apiRouteNotFound(c *gin.Context) {
	c.JSON(http.StatusNotFound, envelope{Success: false, Data: nil, Error: "api route not found", Usage: usage(c)})
}

func serveFrontendFSFile(c *gin.Context, fileSystem http.FileSystem, name string) {
	file, err := fileSystem.Open(name)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil || info.IsDir() {
		c.Status(http.StatusNotFound)
		return
	}
	http.ServeContent(c.Writer, c.Request, path.Base(name), info.ModTime(), file)
}

package httpapi

import (
	"net/http"
	"sort"
	"strings"
	"testing"

	"gptmail/internal/apispec"
	"gptmail/internal/config"
)

type routeKey struct {
	method string
	path   string
}

func TestOpenAPISpecMatchesRoutes(t *testing.T) {
	router := NewRouter(&Handler{
		Config: config.Config{
			FrontendDist: t.TempDir(),
		},
	})

	ginRoutes := map[routeKey]bool{}
	for _, route := range router.Routes() {
		key := routeKey{method: route.Method, path: normalizeGinRoutePath(route.Path)}
		ginRoutes[key] = true
	}

	specRoutes := map[routeKey]string{}
	for _, route := range apispec.RegisteredRoutes() {
		key := routeKey{method: route.Method, path: route.Path}
		if previousID, exists := specRoutes[key]; exists {
			t.Fatalf("duplicate OpenAPI route %s %s: %s and %s", key.method, key.path, previousID, route.ID)
		}
		specRoutes[key] = route.ID
		if !ginRoutes[key] {
			t.Fatalf("OpenAPI route %s %s (%s) is not registered in Gin", key.method, key.path, route.ID)
		}
	}

	var undocumented []string
	for key := range ginRoutes {
		if !strings.HasPrefix(key.path, "/api/") {
			continue
		}
		if _, documented := specRoutes[key]; documented || allowUndocumentedAPIRoute(key) {
			continue
		}
		undocumented = append(undocumented, key.method+" "+key.path)
	}
	sort.Strings(undocumented)
	if len(undocumented) > 0 {
		t.Fatalf("Gin routes missing from OpenAPI registry or allowlist:\n%s", strings.Join(undocumented, "\n"))
	}
}

func normalizeGinRoutePath(routePath string) string {
	parts := strings.Split(routePath, "/")
	for i, part := range parts {
		switch {
		case strings.HasPrefix(part, ":"):
			parts[i] = "{" + strings.TrimPrefix(part, ":") + "}"
		case strings.HasPrefix(part, "*"):
			parts[i] = "{" + strings.TrimPrefix(part, "*") + "}"
		}
	}
	return strings.Join(parts, "/")
}

func allowUndocumentedAPIRoute(key routeKey) bool {
	if strings.HasPrefix(key.path, "/api/admin/") {
		return true
	}
	if strings.HasPrefix(key.path, "/api/auth/") {
		return true
	}
	if strings.HasPrefix(key.path, "/api/oauth/") {
		return true
	}
	if strings.HasPrefix(key.path, "/api/user/") {
		return true
	}
	if strings.HasPrefix(key.path, "/api/api-keys") {
		return true
	}
	if strings.HasSuffix(key.path, "-stream") {
		return true
	}

	allowed := map[routeKey]bool{
		{method: http.MethodGet, path: "/api/version/check"}:               true,
		{method: http.MethodGet, path: "/api/install/status"}:              true,
		{method: http.MethodPost, path: "/api/install"}:                    true,
		{method: http.MethodPost, path: "/api/install/dns-check"}:          true,
		{method: http.MethodGet, path: "/api/email-deliveries/{id}"}:       true,
		{method: http.MethodGet, path: "/api/oauth/providers"}:             true,
		{method: http.MethodGet, path: "/api/brand-icon"}:                  true,
		{method: http.MethodGet, path: "/api/stats/timeseries"}:            true,
		{method: http.MethodGet, path: "/api/mailboxes/stats"}:             true,
		{method: http.MethodPost, path: "/api/domains/request"}:            true,
		{method: http.MethodPost, path: "/api/domains/batch-request"}:      true,
		{method: http.MethodPost, path: "/api/domains/check-mx"}:           true,
		{method: http.MethodGet, path: "/api/domains"}:                     true,
		{method: http.MethodGet, path: "/api/domains/{id}"}:                true,
		{method: http.MethodPatch, path: "/api/domains/{id}"}:              true,
		{method: http.MethodPost, path: "/api/domains/{id}/mx-auto-retry"}: true,
		{method: http.MethodDelete, path: "/api/domains/{id}"}:             true,
		{method: http.MethodGet, path: "/api/notifications"}:               true,
		{method: http.MethodGet, path: "/api/notifications/unread-count"}:  true,
		{method: http.MethodPatch, path: "/api/notifications/{id}/read"}:   true,
		{method: http.MethodPost, path: "/api/notifications/read-all"}:     true,
		{method: http.MethodGet, path: "/api/announcements"}:               true,
		{method: http.MethodGet, path: "/api/announcements/unread-count"}:  true,
		{method: http.MethodPatch, path: "/api/announcements/{id}/read"}:   true,
	}
	return allowed[key]
}

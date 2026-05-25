import json
import os
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from playwright.sync_api import expect, sync_playwright


BASE_URL = os.environ.get("PLAYWRIGHT_BASE_URL", "http://localhost:5174")
SCREENSHOT_DIR = Path("output/playwright")
UPDATE_SCREENSHOTS = os.environ.get("PLAYWRIGHT_UPDATE_SCREENSHOTS") == "1"
NOW = "2026-05-23T08:00:00Z"
CURRENT_USER = None


def main():
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            run_url_state_checks(browser)
            run_desktop_geometry_checks(browser)
            run_mobile_card_checks(browser)
        finally:
            browser.close()


def run_url_state_checks(browser):
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    mock_api(page)
    page.goto(f"{BASE_URL}/#/users?page=2&pageSize=20&search=alice&role=admin&status=enabled")
    expect(page.locator("table[aria-label]").first).to_be_visible()
    expect(page.locator(".data-table-mobile-card").first).to_be_hidden()
    expect(page.locator("input").filter(has_text="").nth(0)).to_be_visible()
    capture_screenshot(page, "table-url-users-desktop.png")

    page.goto(f"{BASE_URL}/#/admin?tab=audit&page=2&pageSize=20&search=login&category=activity&severity=warning&action=oauth.login&target_type=user")
    expect(page.locator("#admin-audit-logs")).to_be_visible()
    expect(page.locator("#admin-audit-logs table[aria-label]").first).to_be_visible()
    assert_no_actions_role(page, "admin-audit-logs", "#admin-audit-logs")
    page.reload()
    expect(page.locator("#admin-audit-logs")).to_be_visible()
    assert_no_actions_role(page, "admin-audit-logs-reload", "#admin-audit-logs")
    assert "tab=audit" in page.url, page.url
    assert "page=2" in page.url, page.url
    assert "search=login" in page.url, page.url

    page.goto(f"{BASE_URL}/#/admin?tab=domainHealth&healthPage=2&healthPageSize=20")
    expect(page.locator("#admin-domain-health")).to_be_visible()
    page.goto(f"{BASE_URL}/#/admin?tab=quotaAlerts&quotaPage=2&quotaPageSize=20")
    expect(page.locator("#admin-quota-alerts")).to_be_visible()
    page.go_back()
    assert "tab=domainHealth" in page.url, page.url
    assert "healthPage=2" in page.url, page.url
    capture_screenshot(page, "table-url-admin-desktop.png")
    page.close()


def run_desktop_geometry_checks(browser):
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    mock_api(page)
    targets = [
        ("dashboard", "#/dashboard", 1),
        ("users", "#/users?page=1&pageSize=20", 1),
        ("domains", "#/domain-management", 2),
        ("share-links", "#/share-links?page=1&pageSize=10", 1),
        ("api-keys", "#/api-keys", 1),
        ("webhooks", "#/webhooks?page=1&perPage=10", 1),
        ("admin-domain-health", "#/admin?tab=domainHealth&healthPage=1&healthPageSize=20", 1),
        ("admin-share-links", "#/admin?tab=shareLinks&sharePage=1&sharePageSize=10", 1),
        ("admin-webhooks", "#/admin?tab=webhooks&webhookPage=1&webhookPageSize=10", 1),
        ("announcements", "#/announcements", 1),
    ]
    for name, hash_route, expected_action_tables in targets:
        page.goto(f"{BASE_URL}/{hash_route}")
        expect(page.locator("table.data-table:visible").first).to_be_visible()
        expect(page.locator(".data-table-mobile-card").first).to_be_hidden()
        assert_actions_column_geometry(page, name, expected_action_tables)
        assert_no_horizontal_overflow(page, f"{name}-desktop")

    page.goto(f"{BASE_URL}/#/users?page=1&pageSize=20")
    page.locator("table.data-table .users-expand-button").first.click()
    expect(page.locator("table.data-table .users-api-keys-detail-panel")).to_be_visible()
    assert_actions_column_geometry(page, "users-expanded", 2)
    assert_no_horizontal_overflow(page, "users-expanded-desktop")
    page.close()


def run_mobile_card_checks(browser):
    page = browser.new_page(viewport={"width": 390, "height": 844})
    mock_api(page)
    targets = [
        ("users", "#/users?page=1&pageSize=20"),
        ("domains", "#/domain-management"),
        ("share-links", "#/share-links?page=1&pageSize=10"),
        ("webhooks", "#/webhooks?page=1&perPage=10"),
        ("api-keys", "#/api-keys"),
        ("admin-webhooks", "#/admin?tab=webhooks&webhookPage=1&webhookPageSize=10"),
    ]
    for name, hash_route in targets:
        page.goto(f"{BASE_URL}/{hash_route}")
        expect(page.locator(".data-table-mobile-card:visible").first).to_be_visible()
        expect(page.locator("table.data-table:visible")).to_have_count(0)
        assert_no_horizontal_overflow(page, name)
        assert_mobile_actions_geometry(page, name)
        capture_screenshot(page, f"table-smoke-{name}-mobile.png")

    page.goto(f"{BASE_URL}/#/users?page=1&pageSize=20")
    page.locator(".data-table-mobile-card .users-expand-button").first.click()
    expect(page.locator(".data-table-mobile-card-span .users-api-keys-detail-panel")).to_be_visible()
    assert_no_horizontal_overflow(page, "users-expanded")
    capture_screenshot(page, "table-smoke-users-expanded-mobile.png")
    page.close()


def capture_screenshot(page, filename):
    if UPDATE_SCREENSHOTS:
        page.screenshot(path=str(SCREENSHOT_DIR / filename), full_page=True)


def assert_no_horizontal_overflow(page, label):
    overflow = page.evaluate(
        "() => { const root = document.scrollingElement || document.documentElement; return root.scrollWidth - window.innerWidth; }"
    )
    assert overflow <= 2, f"{label} horizontal overflow: {overflow}"


def assert_no_actions_role(page, label, scope):
    count = page.locator(f"{scope} table.data-table [data-column-role='actions']").count()
    assert count == 0, f"{label} unexpected actions role columns: {count}"


def assert_actions_column_geometry(page, label, expected_action_tables):
    page.wait_for_function(
        """
        (expected) => {
          const isVisible = (element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
          };
          const tables = Array.from(document.querySelectorAll('table.data-table'))
            .filter(isVisible)
            .filter((table) => Array.from(table.querySelectorAll('tbody td[data-column-role="actions"]')).some(isVisible));
          return tables.length >= expected;
        }
        """,
        arg=expected_action_tables,
    )
    metrics = page.evaluate(
        """
        () => {
          const isVisible = (element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
          };
          const widthOfContent = (cell) => {
            const actions = cell.querySelector('.table-actions');
            const candidates = actions
              ? Array.from(actions.children).filter(isVisible)
              : Array.from(cell.querySelectorAll('button, a, input, select, textarea, [role="button"]'));
            const visibleCandidates = candidates.length > 0 ? candidates : [actions || cell];
            const rects = candidates
              .filter(isVisible)
              .map((element) => element.getBoundingClientRect());
            if (rects.length === 0 && visibleCandidates.length > 0) {
              const fallback = visibleCandidates[0].getBoundingClientRect();
              return fallback.width;
            }
            if (rects.length === 0) return 0;
            const left = Math.min(...rects.map((rect) => rect.left));
            const right = Math.max(...rects.map((rect) => rect.right));
            return right - left;
          };
          return Array.from(document.querySelectorAll('table.data-table'))
            .filter(isVisible)
            .flatMap((table, tableIndex) => {
              const tableLabel = table.getAttribute('aria-label') || `table-${tableIndex}`;
              const actionCells = Array.from(table.querySelectorAll('tbody td[data-column-role="actions"]'))
                .filter(isVisible);
              return actionCells.map((cell, rowIndex) => {
                const rect = cell.getBoundingClientRect();
                const contentWidth = widthOfContent(cell);
                return {
                  tableIndex,
                  tableLabel,
                  rowIndex,
                  key: cell.getAttribute('data-column-key'),
                  cellWidth: rect.width,
                  contentWidth,
                  slack: contentWidth > 0 ? rect.width - contentWidth : rect.width
                };
              });
            });
        }
        """
    )
    table_count = len({metric["tableIndex"] for metric in metrics})
    assert table_count >= expected_action_tables, (
        f"{label} actions tables: expected at least {expected_action_tables}, got {table_count}; metrics={metrics}"
    )
    assert metrics, f"{label} has no desktop actions cells"
    for metric in metrics:
        cell_width = metric["cellWidth"]
        content_width = metric["contentWidth"]
        slack = metric["slack"]
        assert content_width > 0, f"{label} empty actions content: {metric}"
        assert cell_width <= 384, f"{label} actions column too wide: {metric}"
        assert slack <= 96 or cell_width <= content_width + 64, f"{label} actions column has too much blank space: {metric}"


def assert_mobile_actions_geometry(page, label):
    page.wait_for_function(
        """
        () => Array.from(document.querySelectorAll('.data-table-mobile-card-actions')).some((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        })
        """
    )
    metrics = page.evaluate(
        """
        () => {
          const isVisible = (element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
          };
          return Array.from(document.querySelectorAll('.data-table-mobile-card-actions'))
            .filter(isVisible)
            .map((actions, index) => {
              const rect = actions.getBoundingClientRect();
              const controls = Array.from(actions.querySelectorAll('button, a, input, select, textarea, [role="button"]'))
                .filter(isVisible)
                .map((element) => element.getBoundingClientRect());
              const left = controls.length ? Math.min(...controls.map((control) => control.left)) : rect.left;
              const right = controls.length ? Math.max(...controls.map((control) => control.right)) : rect.right;
              return {
                index,
                actionsWidth: rect.width,
                controlsWidth: right - left,
                controls: controls.length,
                cardWidth: actions.closest('.data-table-mobile-card')?.getBoundingClientRect().width || 0
              };
            });
        }
        """
    )
    assert metrics, f"{label} has no mobile actions area"
    for metric in metrics:
        assert metric["controls"] > 0, f"{label} mobile actions have no controls: {metric}"
        assert metric["actionsWidth"] <= metric["cardWidth"] + 2, f"{label} mobile actions overflow card: {metric}"
        assert metric["controlsWidth"] > 0, f"{label} mobile actions controls are empty: {metric}"


def mock_api(page):
    page.route("**/api/**", handle_api_route)


def handle_api_route(route):
    request = route.request
    parsed = urlparse(request.url)
    path = parsed.path
    params = parse_qs(parsed.query)

    if path.endswith("-stream") or path == "/api/inbox-stream":
        route.fulfill(status=200, headers={"content-type": "text/event-stream"}, body="")
        return

    if path == "/api/auth/me":
        data = {"installed": True, "user": current_user()}
    elif path == "/api/install/status":
        data = {"installed": True}
    elif path in {"/api/notifications", "/api/announcements"}:
        data = []
    elif path in {"/api/notifications/unread-count", "/api/announcements/unread-count"}:
        data = {"unread": 0}
    elif path == "/api/stats":
        data = stats()
    elif path == "/api/stats/timeseries":
        data = timeseries_stats()
    elif path == "/api/domains/available":
        data = domain_availability()
    elif path == "/api/mailboxes/stats":
        data = mailbox_stats()
    elif path == "/api/admin/users":
        data = page_of(users(), params, "page_size")
    elif path == "/api/admin/quota-settings":
        data = quota_settings()
    elif is_user_api_keys_path(path):
        data = page_of(api_keys("User key"), params, "page_size")
    elif path == "/api/domains":
        data = domains()
    elif path == "/api/share-links":
        data = page_of(share_links(), params, "per_page")
    elif path == "/api/mailboxes":
        data = page_of(mailboxes(), params, "per_page")
    elif path == "/api/api-keys":
        data = api_keys("Key")
    elif path == "/api/webhooks":
        data = page_of(webhooks(), params, "per_page")
    elif is_webhook_deliveries_path(path):
        data = page_of([], params, "per_page")
    elif path == "/api/admin/stats":
        data = admin_stats()
    elif path == "/api/admin/domain-health":
        data = page_of(domain_health(), params, "per_page")
    elif path == "/api/admin/quota-alerts":
        data = page_of(quota_alerts(), params, "per_page")
    elif path == "/api/admin/domain-check-settings":
        data = domain_check_settings()
    elif path == "/api/admin/domain-check-runs":
        data = domain_check_runs(params)
    elif path == "/api/admin/audit-logs":
        data = page_of(audit_logs(), params, "per_page")
    elif path == "/api/admin/share-links":
        data = page_of(admin_share_links(), params, "per_page")
    elif path == "/api/admin/webhooks":
        data = page_of(admin_webhooks(), params, "per_page")
    elif path == "/api/admin/announcements":
        data = announcements()
    else:
        data = {}

    route.fulfill(
        status=200,
        headers={"content-type": "application/json"},
        body=json.dumps({"success": True, "data": data}),
    )


def is_user_api_keys_path(path):
    parts = path.strip("/").split("/")
    return len(parts) == 5 and parts[0] == "api" and parts[1] == "admin" and parts[2] == "users" and parts[4] == "api-keys"


def is_webhook_deliveries_path(path):
    parts = path.strip("/").split("/")
    return len(parts) == 4 and parts[0] == "api" and parts[1] == "webhooks" and parts[3] == "deliveries"


def page_of(items, params, per_page_key):
    page = positive_int(first(params, "page"), 1)
    per_page = positive_int(first(params, per_page_key), 10)
    start = (page - 1) * per_page
    return {
        "items": items[start:start + per_page],
        "page": page,
        "per_page": per_page,
        "total": len(items),
        "total_pages": max(1, (len(items) + per_page - 1) // per_page),
    }


def first(params, key):
    values = params.get(key)
    return values[0] if values else None


def positive_int(value, fallback):
    try:
        parsed = int(value or "")
        return parsed if parsed > 0 else fallback
    except ValueError:
        return fallback


def current_user():
    global CURRENT_USER
    if CURRENT_USER is None:
        CURRENT_USER = user(1, "admin@example.com", "admin", True)
    return CURRENT_USER


def user(identifier, email, role="user", enabled=True):
    return {
        "id": identifier,
        "email": email,
        "role": role,
        "enabled": enabled,
        "daily_limit": 100,
        "total_limit": 1000,
        "used_today": identifier * 2,
        "total_used": identifier * 20,
        "public_mailbox_created": identifier,
        "public_mailbox_today": identifier,
        "private_mailbox_created": identifier,
        "last_used_at": NOW,
        "created_at": NOW,
    }


def users():
    return [
        current_user(),
        user(2, "alice@example.com", "admin", True),
        user(3, "bob@example.com", "user", False),
        user(4, "carol@example.com"),
        user(5, "dave@example.com"),
        user(6, "erin@example.com", "admin", True),
        user(7, "frank@example.com", "user", False),
        user(8, "grace@example.com"),
        user(9, "heidi@example.com"),
        user(10, "ivy@example.com", "admin", True),
        user(11, "judy@example.com"),
        user(12, "mallory@example.com", "user", False),
        user(13, "oscar@example.com"),
        user(14, "peggy@example.com"),
        user(15, "trent@example.com", "admin", True),
        user(16, "victor@example.com"),
        user(17, "wendy@example.com", "user", False),
        user(18, "zoe@example.com"),
        user(19, "nina@example.com"),
        user(20, "oliver@example.com", "admin", True),
        user(21, "uma@example.com"),
    ]


def stats():
    return {
        "messages": 42,
        "domains": 3,
        "api_keys": 6,
        "mailboxes": 4,
        "public_domains": 2,
        "api_calls_today": 321,
    }


def timeseries_stats():
    return {
        "days": ["05-17", "05-18", "05-19", "05-20", "05-21", "05-22", "05-23"],
        "messages": [3, 5, 8, 6, 9, 10, 11],
        "domains": [1, 1, 2, 2, 2, 3, 3],
        "api_calls": [20, 24, 28, 31, 37, 40, 45],
    }


def domain_availability():
    public_domains = [
        {"id": item["id"], "domain": item["domain"], "mode": item["mode"], "message_count": item["message_count"]}
        for item in domains()
        if item["mode"] == "public"
    ]
    return {
        "domains": [item["domain"] for item in domains()],
        "public_domains": public_domains,
        "private_domains": [],
    }


def mailbox_stats():
    return {
        "public_mailbox_created": 4,
        "public_mailbox_today": 2,
        "public_mailbox_daily_limit": 20,
        "api_key_public_mailbox_daily_limit": 20,
        "private_mailbox_created": 1,
        "has_public_domain": True,
        "require_public_domain": False,
    }


def api_keys(prefix):
    return [
        {
            "id": index + 1,
            "name": f"{prefix} {index + 1}",
            "key_prefix": f"key-hlool-{index + 1}********",
            "enabled": index % 2 == 0,
            "daily_limit": 100,
            "total_limit": 1000,
            "used_today": index * 3,
            "total_used": index * 30,
            "expires_at": "2026-06-23T08:00:00Z" if index % 2 == 0 else None,
            "last_used_at": NOW,
            "created_at": NOW,
        }
        for index in range(6)
    ]


def quota_settings():
    return {
        "id": 1,
        "public_domain_mailbox_limit": 100,
        "user_daily_public_mailbox_limit": 20,
        "require_public_domain_for_quota": False,
        "created_at": NOW,
        "updated_at": NOW,
    }


def domains():
    return [
        domain(1, "example.com", True, True),
        domain(2, "pending.example.com", True, False),
        domain(3, "inactive.example.com", False, False),
    ]


def domain(identifier, name, active, mx_verified):
    return {
        "id": identifier,
        "domain": name,
        "mode": "public" if identifier == 1 else "private",
        "active": active,
        "mx_verified": mx_verified,
        "wildcard_enabled": True,
        "message_count": identifier * 7,
        "last_check_message": "MX verified" if mx_verified else "MX pending",
        "last_mx_records": "mx.example.com",
        "domain_expires_at": "2026-08-01T08:00:00Z",
        "created_at": NOW,
        "updated_at": NOW,
    }


def share_links():
    return [
        {
            "id": index + 1,
            "resource_type": "mailbox",
            "mailbox_id": index + 1,
            "token_prefix": f"share-{index + 1}",
            "key_set": index % 2 == 0,
            "expires_at": "2026-07-01T08:00:00Z",
            "access_count": index * 2,
            "last_accessed_at": NOW,
            "created_at": NOW,
            "updated_at": NOW,
        }
        for index in range(12)
    ]


def admin_share_links():
    return [
        {
            **link,
            "owner_id": 1,
            "owner_email": "admin@example.com" if index % 2 == 0 else "alice@example.com",
            "owner_role": "admin" if index % 2 == 0 else "user",
            "mailbox_email": f"box{index + 1}@example.com",
        }
        for index, link in enumerate(share_links())
    ]


def mailboxes():
    return [
        {
            "id": index + 1,
            "owner_id": 1,
            "email": f"box{index + 1}@example.com",
            "local_part": f"box{index + 1}",
            "host": "example.com",
            "domain_id": 1,
            "message_count": index,
            "created_at": NOW,
        }
        for index in range(4)
    ]


def webhooks():
    return [
        {
            "id": index + 1,
            "name": f"Webhook {index + 1}",
            "url": f"https://hooks.example.com/{index + 1}",
            "secret_preview": f"whsec_{index + 1}****",
            "enabled": index % 2 == 0,
            "events": ["message.received"],
            "scope": "domain" if index % 3 == 0 else "all",
            "domain_id": 1 if index % 3 == 0 else None,
            "failure_count": index,
            "last_success_at": NOW,
            "last_failure_at": NOW if index % 2 else None,
            "created_at": NOW,
            "updated_at": NOW,
        }
        for index in range(12)
    ]


def admin_webhooks():
    return [
        {
            **webhook,
            "owner_id": 1,
            "owner_email": "admin@example.com" if index % 2 == 0 else "alice@example.com",
            "owner_role": "admin" if index % 2 == 0 else "user",
            "domain_name": "example.com" if webhook["scope"] == "domain" else None,
            "mailbox_email": f"box{index + 1}@example.com" if webhook["scope"] == "mailbox" else None,
        }
        for index, webhook in enumerate(webhooks())
    ]


def admin_stats():
    return {
        "messages": 42,
        "active_domains": 2,
        "failed_domains": 1,
        "stale_domains": 1,
        "users": 21,
        "api_usage_today": 321,
        "dev_mode": False,
        "admin_token_enabled": False,
        "admin_token_is_default": False,
        "expected_mx": "mail.example.com",
    }


def domain_health():
    return [
        {**item, "severity": "ok" if index == 0 else "warning", "issue": "healthy" if index == 0 else "mx_failed", "owner_email": "admin@example.com"}
        for index, item in enumerate(domains())
    ]


def quota_alerts():
    return [
        {
            "kind": "user",
            "id": 2,
            "label": "alice@example.com",
            "enabled": True,
            "daily_limit": 20,
            "used_today": 19,
            "total_limit": 1000,
            "total_used": 910,
            "last_used_at": NOW,
            "severity": "warning",
            "reason": "daily_warning",
        },
        {
            "kind": "api_key",
            "id": 1,
            "label": "Webhook key",
            "owner": "admin@example.com",
            "enabled": True,
            "daily_limit": 100,
            "used_today": 101,
            "total_limit": 1000,
            "total_used": 500,
            "last_used_at": NOW,
            "severity": "critical",
            "reason": "daily_exceeded",
        },
    ]


def domain_check_settings():
    runs = domain_check_run_items()
    return {
        "id": 1,
        "enabled": True,
        "interval_minutes": 30,
        "timeout_ms": 3500,
        "max_concurrency": 5,
        "resolver_list_json": "[]",
        "resolvers": ["1.1.1.1:53"],
        "check_inactive": False,
        "failure_threshold": 2,
        "recovery_threshold": 1,
        "global_probe_enabled": False,
        "next_run_at": "2026-05-23T09:00:00Z",
        "recent_runs": runs,
        "last_run": runs[0],
        "created_at": NOW,
        "updated_at": NOW,
    }


def domain_check_runs(params):
    page = page_of(domain_check_run_items(), params, "per_page")
    return {
        "runs": page["items"],
        "total": page["total"],
        "page": page["page"],
        "per_page": page["per_page"],
        "total_pages": page["total_pages"],
    }


def domain_check_run_items():
    return [
        {
            "id": 1,
            "trigger": "manual",
            "status": "success",
            "total": 3,
            "checked": 3,
            "passed": 2,
            "failed": 1,
            "started_at": NOW,
            "finished_at": "2026-05-23T08:01:00Z",
        }
    ]


def audit_logs():
    return [
        {
            "id": index + 1,
            "category": "activity" if index % 2 == 0 else "security",
            "severity": "warning" if index % 3 == 0 else "info",
            "action": "oauth.login" if index % 2 == 0 else "api_key.reveal",
            "actor": "alice@example.com" if index % 2 == 0 else "admin@example.com",
            "target_type": "user",
            "target_id": str(index + 1),
            "target": f"user:{index + 1}",
            "metadata": "login smoke" if index % 2 == 0 else "api key smoke",
            "created_at": NOW,
        }
        for index in range(22)
    ]


def announcements():
    return [
        {
            "id": index + 1,
            "title": f"Announcement {index + 1}",
            "content": "Maintenance window and product update notes.",
            "reader_count": index,
            "created_at": NOW,
        }
        for index in range(4)
    ]


if __name__ == "__main__":
    main()

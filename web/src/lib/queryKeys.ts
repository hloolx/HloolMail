export const queryKeys = {
  me: ['me'] as const,
  installStatus: ['install-status'] as const,
  userOnboarding: ['user-onboarding'] as const,
  oauthProviders: ['oauth-providers'] as const,
  loginSettings: ['login-settings'] as const,
  loginSettingsEmailDelivery: (deliveryId: number | string | null) => ['login-settings', 'email-delivery', deliveryId] as const,
  domains: {
    all: ['domains-all'] as const,
    available: ['domains-available'] as const
  },
  apiKeys: {
    all: ['api-keys'] as const,
    mailboxStats: ['api-keys', 'mailbox-stats'] as const
  },
  admin: {
    announcements: ['admin-announcements'] as const,
    oauthProviders: ['admin-oauth-providers'] as const,
    loginSettings: ['admin-login-settings'] as const,
    loginSettingsEmailDelivery: (deliveryId: number | string | null) => ['admin-login-settings', 'email-delivery', deliveryId] as const,
    quotaSettings: ['admin-quota-settings'] as const,
    stats: ['admin-stats'] as const,
    timeseriesRoot: ['admin-stats-timeseries'] as const,
    timeseries: (range: string) => ['admin-stats-timeseries', range] as const,
    domainHealthRoot: ['admin-domain-health'] as const,
    domainHealth: (page: number, perPage: number, search: string, filters: object) => ['admin-domain-health', page, perPage, search, filters] as const,
    quotaAlertsRoot: ['admin-quota-alerts'] as const,
    quotaAlerts: (page: number, perPage: number) => ['admin-quota-alerts', page, perPage] as const,
    domainCheckSettings: ['admin-domain-check-settings'] as const,
    domainCheckRunsRoot: ['admin-domain-check-runs'] as const,
    domainCheckRuns: (page: number, perPage: number) => ['admin-domain-check-runs', page, perPage] as const,
    apiInterfaceSettings: ['admin-api-interface-settings'] as const,
    auditLogsRoot: ['admin-audit-logs'] as const,
    auditLogs: (filters: object, search: string, page: number, perPage: number) => ['admin-audit-logs', filters, search, page, perPage] as const,
    shareLinksRoot: ['admin-share-links'] as const,
    shareLinks: (page: number, perPage: number, search: string, filters: object) => ['admin-share-links', page, perPage, search, filters] as const,
    shareLinkAccessLogsRoot: (linkId: number) => ['admin-share-link-access-logs', linkId] as const,
    shareLinkAccessLogs: (linkId: number, page: number) => ['admin-share-link-access-logs', linkId, page] as const,
    webhooksRoot: ['admin-webhooks'] as const,
    webhooks: (query: string) => ['admin-webhooks', query] as const,
    webhookDeliveriesRoot: (endpointId: number) => ['admin-webhook-deliveries', endpointId] as const,
    webhookDeliveries: (endpointId: number, page: number) => ['admin-webhook-deliveries', endpointId, page] as const
  },
  webhooks: {
    all: ['webhooks'] as const,
    list: (page: number, perPage: number) => ['webhooks', page, perPage] as const,
    deliveriesRoot: (endpointId: number) => ['webhook-deliveries', endpointId] as const,
    deliveries: (endpointId: number, page: number) => ['webhook-deliveries', endpointId, page] as const,
    adminAll: ['admin-webhooks'] as const,
    adminList: (query: string) => ['admin-webhooks', query] as const,
    adminDeliveriesRoot: (endpointId: number) => ['admin-webhook-deliveries', endpointId] as const,
    adminDeliveries: (endpointId: number, page: number) => ['admin-webhook-deliveries', endpointId, page] as const
  }
};

export const adminPageDefinitions = [
  { page: 'admin-overview' },
  { page: 'admin-dns', legacyTab: 'dns' },
  { page: 'admin-domains', legacyTab: 'domainHealth' },
  { page: 'admin-quota-alerts', legacyTab: 'quotaAlerts' },
  { page: 'admin-api-interfaces', legacyTab: 'apiInterfaces' },
  { page: 'admin-share-links', legacyTab: 'shareLinks' },
  { page: 'admin-webhooks', legacyTab: 'webhooks' },
  { page: 'admin-audit', legacyTab: 'audit' }
] as const;

export type AdminPageId = (typeof adminPageDefinitions)[number]['page'];

export const adminPageIds = adminPageDefinitions.map((definition) => definition.page) as readonly AdminPageId[];
export const defaultAdminPageId: AdminPageId = 'admin-overview';

const adminPageIdSet = new Set<AdminPageId>(adminPageIds);

export function isAdminPageId(value: string): value is AdminPageId {
  return adminPageIdSet.has(value as AdminPageId);
}

export function adminLegacyTabAliases(): Record<string, AdminPageId> {
  return Object.fromEntries(
    adminPageDefinitions.flatMap((definition) => (
      'legacyTab' in definition ? [[definition.legacyTab, definition.page] as const] : []
    ))
  ) as Record<string, AdminPageId>;
}

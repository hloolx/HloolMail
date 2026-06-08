import {
  Activity,
  BarChart3,
  Database,
  Globe2,
  KeyRound,
  ScrollText,
  Share2,
  Shield,
  Webhook,
  type LucideIcon
} from 'lucide-react';
import { createElement, lazy, type ComponentType, type LazyExoticComponent, type ReactElement } from 'react';
import type zhCN from '../../locales/zh-CN';
import { adminPageIds, type AdminPageId } from './pageIds';

export {
  adminLegacyTabAliases,
  adminPageIds,
  defaultAdminPageId,
  isAdminPageId,
  type AdminPageId
} from './pageIds';

type LocaleText = typeof zhCN;
type AdminLazyComponent = LazyExoticComponent<ComponentType>;

const AdminOverviewPage = lazy(() => import('./pages/AdminOverviewPage').then((module) => ({ default: module.AdminOverviewPage })));
const AdminDnsPage = lazy(() => import('./pages/AdminDnsPage').then((module) => ({ default: module.AdminDnsPage })));
const AdminDomainsPage = lazy(() => import('./pages/AdminDomainsPage').then((module) => ({ default: module.AdminDomainsPage })));
const AdminQuotaAlertsPage = lazy(() => import('./pages/AdminQuotaAlertsPage').then((module) => ({ default: module.AdminQuotaAlertsPage })));
const AdminApiInterfacesPage = lazy(() => import('./pages/AdminApiInterfacesPage').then((module) => ({ default: module.AdminApiInterfacesPage })));
const AdminShareLinksPage = lazy(() => import('./pages/AdminShareLinksPage').then((module) => ({ default: module.AdminShareLinksPage })));
const AdminWebhooksPage = lazy(() => import('./pages/AdminWebhooksPage').then((module) => ({ default: module.AdminWebhooksPage })));
const AdminAuditPage = lazy(() => import('./pages/AdminAuditPage').then((module) => ({ default: module.AdminAuditPage })));

type AdminSectionDefinition = {
  page: AdminPageId;
  labelKey: keyof LocaleText['page'];
  icon: LucideIcon;
  requiredRole: 'admin';
  navGroup: 'admin';
  legacyTab?: string;
  component: AdminLazyComponent;
};

export const adminSections = [
  { page: 'admin-overview', labelKey: 'admin-overview', icon: Shield, requiredRole: 'admin', navGroup: 'admin', component: AdminOverviewPage },
  { page: 'admin-dns', labelKey: 'admin-dns', icon: Database, requiredRole: 'admin', navGroup: 'admin', legacyTab: 'dns', component: AdminDnsPage },
  { page: 'admin-domains', labelKey: 'admin-domains', icon: Globe2, requiredRole: 'admin', navGroup: 'admin', legacyTab: 'domainHealth', component: AdminDomainsPage },
  { page: 'admin-quota-alerts', labelKey: 'admin-quota-alerts', icon: BarChart3, requiredRole: 'admin', navGroup: 'admin', legacyTab: 'quotaAlerts', component: AdminQuotaAlertsPage },
  { page: 'admin-api-interfaces', labelKey: 'admin-api-interfaces', icon: KeyRound, requiredRole: 'admin', navGroup: 'admin', legacyTab: 'apiInterfaces', component: AdminApiInterfacesPage },
  { page: 'admin-share-links', labelKey: 'admin-share-links', icon: Share2, requiredRole: 'admin', navGroup: 'admin', legacyTab: 'shareLinks', component: AdminShareLinksPage },
  { page: 'admin-webhooks', labelKey: 'admin-webhooks', icon: Webhook, requiredRole: 'admin', navGroup: 'admin', legacyTab: 'webhooks', component: AdminWebhooksPage },
  { page: 'admin-audit', labelKey: 'admin-audit', icon: ScrollText, requiredRole: 'admin', navGroup: 'admin', legacyTab: 'audit', component: AdminAuditPage }
] as const satisfies readonly AdminSectionDefinition[];

export type AdminSection = (typeof adminSections)[number];

const adminSectionByPage = new Map<AdminPageId, AdminSection>(
  adminSections.map((section) => [section.page, section])
);
const adminElementByPage = new Map<AdminPageId, ReactElement>(
  adminSections.map((section) => [section.page, createElement(section.component)])
);

export const adminPageSet = new Set<AdminPageId>(adminPageIds);

export function adminNavItems(text: LocaleText) {
  return adminSections.map((section) => ({
    page: section.page,
    label: text.page[section.labelKey],
    icon: section.icon
  }));
}

export function getAdminSection(page: string): AdminSection | undefined {
  return adminSectionByPage.get(page as AdminPageId);
}

export function getAdminPageComponent(page: string): AdminLazyComponent | undefined {
  return getAdminSection(page)?.component;
}

export function getAdminPageElement(page: string): ReactElement | null {
  return adminElementByPage.get(page as AdminPageId) ?? null;
}

export function adminOverviewQuickActions(text: LocaleText) {
  return [
    { page: 'admin-domains', label: text.page['admin-domains'], icon: Globe2 },
    { page: 'admin-quota-alerts', label: text.page['admin-quota-alerts'], icon: BarChart3 },
    { page: 'admin-audit', label: text.page['admin-audit'], icon: Activity },
    { page: 'admin-dns', label: text.page['admin-dns'], icon: Database }
  ];
}

import {
  Activity,
  BookOpen,
  Globe2,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LogIn,
  Megaphone,
  Network,
  Settings,
  Share2,
  UserCog,
  Webhook,
  type LucideIcon
} from 'lucide-react';
import type { User } from '../../api';
import { currentText } from '../../locales';
import type { Page } from '../../store';
import { adminNavSectionItems } from '../../features/admin/sectionRegistry';

export type NavLeafItem = { page: Page; label: string; icon: LucideIcon };
export type NavBranchItem = { label: string; icon: LucideIcon; items: NavLeafItem[]; defaultOpen?: boolean };
export type NavItem = NavLeafItem | NavBranchItem;

export function isNavBranch(item: NavItem): item is NavBranchItem {
  return 'items' in item;
}

export function navGroups(user: User, text = currentText()): { title: string; items: NavItem[] }[] {
  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: text.nav.mail,
      items: [
        { page: 'dashboard' as Page, label: text.page.dashboard, icon: LayoutDashboard },
        { page: 'inbox' as Page, label: text.page.inbox, icon: Inbox },
        { page: 'share-links' as Page, label: text.page['share-links'], icon: Share2 }
      ]
    },
    {
      title: text.nav.domains,
      items: [
        { page: 'domain-management' as Page, label: text.page['domain-management'], icon: Globe2 }
      ]
    },
    {
      title: text.nav.automation,
      items: [
        { page: 'api-keys' as Page, label: text.page['api-keys'], icon: KeyRound },
        { page: 'webhooks' as Page, label: text.page.webhooks, icon: Webhook },
        { page: 'api-docs' as Page, label: text.page['api-docs'], icon: BookOpen }
      ]
    }
  ];
  if (user.role === 'admin') {
    const adminSections = adminNavSectionItems(text);
    groups.push({
      title: text.nav.admin,
      items: [
        adminSections.overview,
        {
          label: text.nav.adminAccounts,
          icon: UserCog,
          defaultOpen: true,
          items: [
            { page: 'users' as Page, label: text.page.users, icon: UserCog },
            adminSections.quotaAlerts
          ]
        },
        {
          label: text.nav.adminOperations,
          icon: Activity,
          defaultOpen: true,
          items: [
            adminSections.dns,
            adminSections.domains,
            adminSections.audit
          ]
        },
        {
          label: text.nav.adminGovernance,
          icon: Network,
          items: [
            adminSections.apiInterfaces,
            adminSections.shareLinks,
            adminSections.webhooks
          ]
        },
        {
          label: text.nav.adminSettings,
          icon: Settings,
          items: [
            { page: 'admin-oauth' as Page, label: text.page['admin-oauth'], icon: LogIn },
            { page: 'announcements' as Page, label: text.page.announcements, icon: Megaphone }
          ]
        }
      ]
    });
  }
  return groups;
}

export function pageTitle(page: Page, text = currentText()) {
  return text.page[page];
}

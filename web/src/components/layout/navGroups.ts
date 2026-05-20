import { BookOpen, Globe2, Inbox, KeyRound, LayoutDashboard, LogIn, Megaphone, Share2, Shield, UserCog, Webhook } from 'lucide-react';
import type { User } from '../../api';
import { currentText } from '../../locales';
import type { Page } from '../../store';

export type NavItem = { page: Page; label: string; icon: typeof Inbox };

export function navGroups(user: User, text = currentText()): { title: string; items: NavItem[] }[] {
  const groups = [
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
    groups.push({
      title: text.nav.admin,
      items: [
        { page: 'users' as Page, label: text.page.users, icon: UserCog },
        { page: 'admin-oauth' as Page, label: text.page['admin-oauth'], icon: LogIn },
        { page: 'admin' as Page, label: text.page.admin, icon: Shield },
        { page: 'announcements' as Page, label: text.page.announcements, icon: Megaphone }
      ]
    });
  }
  return groups;
}

export function pageTitle(page: Page, text = currentText()) {
  return text.page[page];
}

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, LogOut } from 'lucide-react';
import { roleText, useText } from '../../locales';
import type { User } from '../../api';
import { postJSON } from '../../api';
import { useAppStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { clearUserSession } from '../../lib/queryClient';
import { displayName, displaySubtitle } from '../../lib/userDisplay';
import { isMobileNavigationViewport } from '../../lib/navigationBreakpoint';
import { UserAvatar } from '../shared';
import { UserProfileDialog } from '../../pages/UserProfileDialog';
import { isNavBranch, navGroups, type NavBranchItem, type NavLeafItem } from './navGroups';

const branchStateKey = (item: NavBranchItem) => item.items.map((child) => child.page).join('|') || item.label;

export function Sidebar({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const {
    page,
    setPage,
    sidebarCollapsed,
    mobileSidebarOpen,
    closeMobileSidebar,
    toggleSidebar
  } = useAppStore(
    useShallow((s) => ({
      page: s.page,
      setPage: s.setPage,
      sidebarCollapsed: s.sidebarCollapsed,
      mobileSidebarOpen: s.mobileSidebarOpen,
      closeMobileSidebar: s.closeMobileSidebar,
      toggleSidebar: s.toggleSidebar
    }))
  );
  const text = useText();
  const groups = useMemo(() => navGroups(user, text), [text, user]);
  const visuallyCollapsed = sidebarCollapsed && !mobileSidebarOpen;
  const sidebarTitle = sidebarCollapsed ? text.nav.expandSidebar : text.nav.collapseSidebar;
  const [profileOpen, setProfileOpen] = useState(false);
  const [openBranches, setOpenBranches] = useState<Record<string, boolean>>({});
  const userName = displayName(user);
  const userSubtitle = displaySubtitle(user) || roleText(user.role, text);

  useEffect(() => {
    setOpenBranches((current) => {
      let changed = false;
      const next = { ...current };

      for (const group of groups) {
        for (const item of group.items) {
          if (!isNavBranch(item)) continue;
          if (!item.items.some((child) => child.page === page)) continue;
          const key = branchStateKey(item);
          if (next[key]) continue;
          next[key] = true;
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [groups, page]);

  const navigateTo = (item: NavLeafItem) => {
    setPage(item.page);
    if (isMobileNavigationViewport()) closeMobileSidebar();
  };

  const logout = useMutation({
    mutationFn: () => postJSON('/api/auth/logout', {}),
    onSuccess: () => {
      clearUserSession(queryClient);
      if (window.location.hash) window.location.hash = '';
    }
  });
  return (
    <>
      {mobileSidebarOpen && (
        <button
          className="sidebar-overlay"
          type="button"
          aria-label={text.nav.collapseSidebar}
          onClick={closeMobileSidebar}
        />
      )}
      <aside className={`sidebar ${visuallyCollapsed ? 'sidebar-collapsed' : ''} ${mobileSidebarOpen ? 'sidebar-mobile-open' : 'sidebar-mobile-closed'}`}>
      <div className="sidebar-inner">
        <nav className="sidebar-nav">
          {groups.map((group) => (
            <div className="sidebar-nav-group" key={group.title}>
              <div className="sidebar-group-title">{group.title}</div>
              <div className="sidebar-nav-items">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  if (isNavBranch(item)) {
                    const branchKey = branchStateKey(item);
                    const active = item.items.some((child) => child.page === page);
                    const open = openBranches[branchKey] ?? item.defaultOpen ?? active;
                    return (
                      <div className={`nav-branch ${open ? 'nav-branch-open' : ''} ${active ? 'nav-branch-active' : ''}`} key={branchKey}>
                        <button
                          className={`nav-item nav-branch-trigger ${active ? 'nav-branch-trigger-active' : ''}`}
                          type="button"
                          onClick={() => {
                            if (visuallyCollapsed) {
                              navigateTo(item.items[0]);
                              return;
                            }
                            setOpenBranches((current) => ({ ...current, [branchKey]: !open }));
                          }}
                          title={visuallyCollapsed ? item.label : undefined}
                          aria-label={visuallyCollapsed ? item.label : undefined}
                          aria-expanded={open}
                        >
                          <Icon size={16} />
                          <span className="sidebar-label nav-item-text">{item.label}</span>
                          <ChevronRight className="sidebar-label nav-branch-chevron" size={14} aria-hidden="true" />
                        </button>
                        <div className="sidebar-label nav-sub-items" hidden={!open}>
                          {item.items.map((child) => {
                            const ChildIcon = child.icon;
                            const childActive = page === child.page;
                            return (
                              <button
                                key={child.page}
                                className={`nav-item nav-sub-item ${childActive ? 'nav-item-active' : ''}`}
                                type="button"
                                onClick={() => navigateTo(child)}
                                title={visuallyCollapsed ? child.label : undefined}
                                aria-label={visuallyCollapsed ? child.label : undefined}
                                aria-current={childActive ? 'page' : undefined}
                              >
                                <ChildIcon size={15} />
                                <span className="sidebar-label nav-item-text">{child.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  const active = page === item.page;
                  return (
                    <button
                      key={item.page}
                      className={`nav-item ${active ? 'nav-item-active' : ''}`}
                      type="button"
                      onClick={() => navigateTo(item)}
                      title={visuallyCollapsed ? item.label : undefined}
                      aria-label={visuallyCollapsed ? item.label : undefined}
                      aria-current={active ? 'page' : undefined}
                    >
                      <Icon size={16} />
                      <span className="sidebar-label nav-item-text">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="sidebar-user-card" title={`${userName} · ${roleText(user.role, text)}`}>
          <button
            className="sidebar-user-profile-btn"
            type="button"
            title={text.profile.open}
            aria-label={text.profile.open}
            onClick={() => setProfileOpen(true)}
          >
            <UserAvatar user={user} className="sidebar-user-avatar" />
            <div className="sidebar-user-copy sidebar-label">
              <div>{userName}</div>
              <span>{userSubtitle}</span>
            </div>
          </button>
          <button
            className="sidebar-logout-btn"
            type="button"
            title={text.settings.logout}
            aria-label={text.settings.logout}
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
      <button className="sidebar-rail" type="button" title={sidebarTitle} aria-label={sidebarTitle} onClick={toggleSidebar} />
      <UserProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} user={user} />
      </aside>
    </>
  );
}

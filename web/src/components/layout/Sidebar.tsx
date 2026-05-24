import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { roleText, useText } from '../../locales';
import type { User } from '../../api';
import { postJSON } from '../../api';
import { useAppStore } from '../../store';
import { clearUserSession } from '../../lib/queryClient';
import { UserProfileDialog } from '../../pages/UserProfileDialog';
import { navGroups } from './navGroups';

export function Sidebar({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const {
    page,
    setPage,
    sidebarCollapsed,
    mobileSidebarOpen,
    closeMobileSidebar,
    toggleSidebar
  } = useAppStore();
  const text = useText();
  const sidebarTitle = sidebarCollapsed ? text.nav.expandSidebar : text.nav.collapseSidebar;
  const [profileOpen, setProfileOpen] = useState(false);

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
      <aside className={`sidebar ${sidebarCollapsed && !mobileSidebarOpen ? 'sidebar-collapsed' : ''} ${mobileSidebarOpen ? 'sidebar-mobile-open' : 'sidebar-mobile-closed'}`}>
      <div className="sidebar-inner">
        <nav className="sidebar-nav">
          {navGroups(user, text).map((group) => (
            <div className="sidebar-nav-group" key={group.title}>
              <div className="sidebar-group-title">{group.title}</div>
              <div className="sidebar-nav-items">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = page === item.page;
                  return (
                    <button
                      key={item.page}
                      className={`nav-item ${active ? 'nav-item-active' : ''}`}
                      type="button"
                      onClick={() => {
                        setPage(item.page);
                        if (window.innerWidth < 1024) closeMobileSidebar();
                      }}
                      title={sidebarCollapsed ? item.label : undefined}
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

        <div className="sidebar-user-card" title={`${user.email} · ${roleText(user.role, text)}`}>
          <button
            className="sidebar-user-profile-btn"
            type="button"
            title={text.profile.open}
            aria-label={text.profile.open}
            onClick={() => setProfileOpen(true)}
          >
            <div className="sidebar-user-avatar">{user.email.slice(0, 1).toUpperCase()}</div>
            <div className="sidebar-user-copy sidebar-label">
              <div>{user.email}</div>
              <span>{roleText(user.role, text)}</span>
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

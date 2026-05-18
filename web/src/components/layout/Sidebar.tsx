import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { roleText, useText } from '../../locales';
import type { User } from '../../api';
import { postJSON } from '../../api';
import { useAppStore } from '../../store';
import { navGroups } from './navGroups';

export function Sidebar({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const { page, setPage, sidebarCollapsed, toggleSidebar } = useAppStore();
  const text = useText();
  const sidebarTitle = sidebarCollapsed ? text.nav.expandSidebar : text.nav.collapseSidebar;

  const logout = useMutation({
    mutationFn: () => postJSON('/api/auth/logout', {}),
    onSuccess: () => {
      try { localStorage.removeItem('hlool-mail.email'); } catch { /* ignore */ }
      if (window.location.hash) window.location.hash = '';
      queryClient.invalidateQueries({ queryKey: ['me'] });
    }
  });
  return (
    <aside className={`sidebar fixed inset-y-0 left-0 z-30 border-r border-[var(--border)] bg-[var(--sidebar)] transition-transform duration-300 lg:block ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${sidebarCollapsed ? '-translate-x-full lg:translate-x-0' : 'translate-x-0'}`}>
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
                      onClick={() => {
                        setPage(item.page);
                        if (window.innerWidth < 1024 && !sidebarCollapsed) toggleSidebar();
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
          <div className="sidebar-user-avatar">{user.email.slice(0, 1).toUpperCase()}</div>
          <div className="sidebar-user-copy sidebar-label">
            <div>{user.email}</div>
            <span>{roleText(user.role, text)}</span>
          </div>
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
      <button className="sidebar-rail" title={sidebarTitle} aria-label={sidebarTitle} onClick={toggleSidebar} />
    </aside>
  );
}

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useText } from '../../locales';
import type { User } from '../../api';
import { useAppStore, type Page } from '../../store';
import { isMobileNavigationViewport } from '../../lib/navigationBreakpoint';
import { isNavBranch, navGroups, type NavBranchItem, type NavLeafItem } from './navGroups';

const branchStateKey = (item: NavBranchItem) => item.items.map((child) => child.page).join('|') || item.label;

type SidebarFlyoutProps = {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  flyoutRef: RefObject<HTMLDivElement | null>;
  label: string;
  children: ReactNode;
};

function SidebarFlyout({ open, anchorRef, flyoutRef, label, children }: SidebarFlyoutProps) {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return undefined;
    }

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const sidebarRect = anchor.closest('.sidebar')?.getBoundingClientRect();
      const viewportPadding = 8;
      const menuWidth = Math.min(224, Math.max(176, window.innerWidth - viewportPadding * 2));
      const rawLeft = Math.max(rect.right + 8, (sidebarRect?.right ?? rect.right) + 8);
      const left = Math.min(
        Math.max(viewportPadding, rawLeft),
        Math.max(viewportPadding, window.innerWidth - viewportPadding - menuWidth)
      );
      const top = Math.min(
        Math.max(viewportPadding, rect.top - 4),
        Math.max(viewportPadding, window.innerHeight - viewportPadding - 96)
      );

      setStyle({
        position: 'fixed',
        top,
        left,
        width: menuWidth,
        zIndex: 80
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, open]);

  if (!open || typeof document === 'undefined' || !style) return null;

  return createPortal(
    <div ref={flyoutRef} className="sidebar-flyout" role="menu" aria-label={label} style={style}>
      {children}
    </div>,
    document.body
  );
}

type SidebarBranchProps = {
  item: NavBranchItem;
  branchKey: string;
  active: boolean;
  open: boolean;
  currentPage: Page;
  visuallyCollapsed: boolean;
  activeFlyoutKey: string | null;
  setActiveFlyoutKey: (key: string | null) => void;
  setOpenBranches: Dispatch<SetStateAction<Record<string, boolean>>>;
  navigateTo: (item: NavLeafItem) => void;
};

function SidebarBranchItem({
  item,
  branchKey,
  active,
  open,
  currentPage,
  visuallyCollapsed,
  activeFlyoutKey,
  setActiveFlyoutKey,
  setOpenBranches,
  navigateTo
}: SidebarBranchProps) {
  const Icon = item.icon;
  const anchorRef = useRef<HTMLButtonElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const flyoutOpen = visuallyCollapsed && activeFlyoutKey === branchKey;

  useEffect(() => {
    if (!flyoutOpen) return undefined;

    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || flyoutRef.current?.contains(target)) return;
      setActiveFlyoutKey(null);
    };
    const closeByKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveFlyoutKey(null);
    };

    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', closeByKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', closeByKey);
    };
  }, [flyoutOpen, setActiveFlyoutKey]);

  return (
    <div className={`nav-branch ${open ? 'nav-branch-open' : ''} ${active ? 'nav-branch-active' : ''}`}>
      <button
        ref={anchorRef}
        className={`nav-item nav-branch-trigger ${active ? 'nav-branch-trigger-active' : ''}`}
        type="button"
        onClick={() => {
          if (visuallyCollapsed) {
            setActiveFlyoutKey(flyoutOpen ? null : branchKey);
            return;
          }
          setOpenBranches((current) => ({ ...current, [branchKey]: !open }));
        }}
        title={visuallyCollapsed ? item.label : undefined}
        aria-label={visuallyCollapsed ? item.label : undefined}
        aria-expanded={visuallyCollapsed ? flyoutOpen : open}
        aria-haspopup={visuallyCollapsed ? 'menu' : undefined}
      >
        <Icon size={16} />
        <span className="sidebar-label nav-item-text">{item.label}</span>
        <ChevronRight className="sidebar-label nav-branch-chevron" size={14} aria-hidden="true" />
      </button>

      <div className="sidebar-label nav-sub-items" hidden={!open}>
        {item.items.map((child) => {
          const ChildIcon = child.icon;
          const childActive = active && child.page === currentPage;
          return (
            <button
              key={child.page}
              className={`nav-item nav-sub-item ${childActive ? 'nav-item-active' : ''}`}
              type="button"
              onClick={() => navigateTo(child)}
              aria-current={childActive ? 'page' : undefined}
            >
              <ChildIcon size={15} />
              <span className="sidebar-label nav-item-text">{child.label}</span>
            </button>
          );
        })}
      </div>

      <SidebarFlyout open={flyoutOpen} anchorRef={anchorRef} flyoutRef={flyoutRef} label={item.label}>
        <div className="sidebar-flyout-label">{item.label}</div>
        <div className="sidebar-flyout-list">
          {item.items.map((child) => {
            const ChildIcon = child.icon;
            const childActive = child.page === currentPage;
            return (
              <button
                key={child.page}
                className={`sidebar-flyout-item ${childActive ? 'sidebar-flyout-item-active' : ''}`}
                type="button"
                role="menuitem"
                onClick={() => {
                  navigateTo(child);
                  setActiveFlyoutKey(null);
                }}
              >
                <ChildIcon size={15} />
                <span>{child.label}</span>
              </button>
            );
          })}
        </div>
      </SidebarFlyout>
    </div>
  );
}

export function Sidebar({ user }: { user: User }) {
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
  const [openBranches, setOpenBranches] = useState<Record<string, boolean>>({});
  const [activeFlyoutKey, setActiveFlyoutKey] = useState<string | null>(null);

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

  useEffect(() => {
    if (!visuallyCollapsed) setActiveFlyoutKey(null);
  }, [visuallyCollapsed]);

  const navigateTo = (item: NavLeafItem) => {
    setPage(item.page);
    setActiveFlyoutKey(null);
    if (isMobileNavigationViewport()) closeMobileSidebar();
  };

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
      <div className={`sidebar-shell ${visuallyCollapsed ? 'sidebar-shell-collapsed' : ''}`}>
        <div className="sidebar-gap" aria-hidden="true" />
        <aside className={`sidebar ${visuallyCollapsed ? 'sidebar-collapsed' : ''} ${mobileSidebarOpen ? 'sidebar-mobile-open' : 'sidebar-mobile-closed'}`}>
          <div className="sidebar-inner">
            <nav className="sidebar-nav" aria-label={text.nav.subtitle}>
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
                          <SidebarBranchItem
                            key={branchKey}
                            item={item}
                            branchKey={branchKey}
                            active={active}
                            open={open}
                            currentPage={page}
                            visuallyCollapsed={visuallyCollapsed}
                            activeFlyoutKey={activeFlyoutKey}
                            setActiveFlyoutKey={setActiveFlyoutKey}
                            setOpenBranches={setOpenBranches}
                            navigateTo={navigateTo}
                          />
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
          </div>
          <button className="sidebar-rail" type="button" title={sidebarTitle} aria-label={sidebarTitle} onClick={toggleSidebar} />
        </aside>
      </div>
    </>
  );
}

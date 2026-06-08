import { useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle, ChevronDown, ChevronRight, Copy, Eye, KeyRound, Loader2, Pencil, Save, Search, Trash2, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import type { APIKey, PaginatedResponse, SystemQuotaSettings, User } from '../api';
import { api, patchJSON, postJSON } from '../api';
import { roleText, useText } from '../locales';
import { notifySuccess, runDeleteEffect } from '../lib/feedback';
import { queryKeys } from '../lib/queryKeys';
import { boolBadge, formatAPIKeyExpiry, relativeTime } from '../lib/display';
import { copy as copyText } from '../lib/clipboard';
import { displayName, displaySubtitle } from '../lib/userDisplay';
import { useTableUrlState } from '../hooks/useTableUrlState';
import { ConfirmModal, DataTable, DataTableToolbar, DataTableViewOptions, IconButton, InfoTip, PaginationControls, QuotaThermometer } from '../components/shared';
import type { DataTableColumn } from '../components/shared';
import { CreateUserDialog } from './CreateUserDialog';
import { EditUserDialog } from './EditUserDialog';
import { type UserForm, buildCreatePayload, buildUpdatePayload } from './userFormHelpers';

const USER_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const USER_API_KEY_PAGE_SIZE_OPTIONS = [5, 10, 20];
const USER_ROLE_FILTER_OPTIONS = ['all', 'admin', 'user'] as const;
const USER_STATUS_FILTER_OPTIONS = ['all', 'enabled', 'disabled'] as const;
const INVALID_QUOTA_MESSAGE = 'Quota values must be whole numbers greater than or equal to 0.';

type UserTableFilters = {
  role: 'all' | User['role'];
  status: 'all' | 'enabled' | 'disabled';
};

export function UsersPage({ currentUser }: { currentUser: User }) {
  const queryClient = useQueryClient();
  const text = useText();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    search,
    setSearch,
    filters,
    setFilter
  } = useTableUrlState<UserTableFilters>({
    defaultPageSize: 20,
    defaultSearch: '',
    defaultFilters: { role: 'all', status: 'all' },
    filterOptions: {
      role: USER_ROLE_FILTER_OPTIONS,
      status: USER_STATUS_FILTER_OPTIONS
    },
    pageSizeOptions: USER_PAGE_SIZE_OPTIONS
  });
  const deferredSearch = useDeferredValue(search.trim());
  const roleFilter = filters.role;
  const statusFilter = filters.status;
  const [hiddenColumnKeys, setHiddenColumnKeys] = useState<string[]>([]);
  const [expandedUserIds, setExpandedUserIds] = useState<number[]>([]);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [disableTarget, setDisableTarget] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [dissolveTarget, setDissolveTarget] = useState<HTMLElement | null>(null);
  const [quotaDirty, setQuotaDirty] = useState(false);
  const quotaSaveButtonRef = useRef<HTMLButtonElement | null>(null);
  const userFeedbackOriginRef = useRef<HTMLElement | null>(null);
  const deleteInFlightRef = useRef(false);
  const users = useQuery({
    queryKey: ['users', page, pageSize, deferredSearch, roleFilter, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize)
      });
      const term = deferredSearch;
      if (term) params.set('search', term);
      if (roleFilter !== 'all') params.set('role', roleFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      return api<PaginatedResponse<User>>(`/api/admin/users?${params.toString()}`);
    },
    retry: false,
    staleTime: 30_000
  });
  const userPage = users.data;
  const visibleUsers = userPage?.items || [];
  const userColumns = useMemo<DataTableColumn[]>(() => [
    { key: 'expand', header: <span className="sr-only">{text.users.apiKeysTitle}</span>, align: 'center', width: '3rem', hideable: false, mobileBadge: true },
    { key: 'email', header: text.users.account, minWidth: '15rem', mobileTitle: true },
    { key: 'role', header: text.users.role, width: '7rem', mobileSubtitle: true },
    { key: 'enabled', header: text.users.enabled, align: 'center', width: '6rem', mobileBadge: true },
    { key: 'today-usage', header: text.users.todayUsage, align: 'right', width: '8rem', mobilePriority: 1 },
    { key: 'total-usage', header: text.users.totalUsage, align: 'right', width: '8rem', mobilePriority: 2 },
    { key: 'last-used', header: text.users.lastUsed, width: '8rem', mobilePriority: 3 },
    { key: 'actions', role: 'actions', header: text.users.actions, align: 'right', minWidth: '15rem', hideable: false }
  ], [text]);

  const toggleUserApiKeys = (userId: number) => {
    setExpandedUserIds((current) => (
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    ));
  };

  const invalidateUserViews = () => {
    queryClient.invalidateQueries({ queryKey: ['users'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.stats });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.quotaAlertsRoot });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.auditLogsRoot });
  };

  const create = useMutation({
    mutationFn: (form: UserForm) => postJSON<User>('/api/admin/users', buildCreatePayload(form)),
    onSuccess: () => {
      invalidateUserViews();
      setShowCreateDialog(false);
      notifySuccess(text.toast.userCreated, { origin: userFeedbackOriginRef.current });
      userFeedbackOriginRef.current = null;
    },
    onError: (error) => {
      userFeedbackOriginRef.current = null;
      toast.error(error.message);
    }
  });

  const quotaSettings = useQuery({
    queryKey: queryKeys.admin.quotaSettings,
    queryFn: () => api<SystemQuotaSettings>('/api/admin/quota-settings'),
    retry: false,
    staleTime: 30_000
  });
  const [quotaForm, setQuotaForm] = useState({
    public_domain_mailbox_limit: '0',
    user_daily_public_mailbox_limit: '0',
    require_public_domain_for_quota: false,
    enable_user_onboarding: false
  });
  const quotaValidationError = validateQuotaForm(quotaForm);
  useEffect(() => {
    const qs = quotaSettings.data;
    if (!qs || quotaDirty) return;
    setQuotaForm({
      public_domain_mailbox_limit: String(qs.public_domain_mailbox_limit),
      user_daily_public_mailbox_limit: String(qs.user_daily_public_mailbox_limit),
      require_public_domain_for_quota: qs.require_public_domain_for_quota,
      enable_user_onboarding: qs.enable_user_onboarding
    });
  }, [quotaDirty, quotaSettings.data]);

  const saveQuotaSettings = useMutation({
    mutationFn: () => patchJSON<SystemQuotaSettings>('/api/admin/quota-settings', {
      public_domain_mailbox_limit: parseNonNegativeInteger(quotaForm.public_domain_mailbox_limit),
      user_daily_public_mailbox_limit: parseNonNegativeInteger(quotaForm.user_daily_public_mailbox_limit),
      require_public_domain_for_quota: quotaForm.require_public_domain_for_quota,
      enable_user_onboarding: quotaForm.enable_user_onboarding
    }),
    onSuccess: () => {
      setQuotaDirty(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.quotaSettings });
      notifySuccess(text.admin.quotaSettings.saved, { origin: quotaSaveButtonRef.current });
    },
    onError: (error) => toast.error(error.message)
  });

  const updateUser = useMutation({
    mutationFn: ({ user, form }: { user: User; form: UserForm }) => patchJSON<User>(`/api/admin/users/${user.id}`, buildUpdatePayload(form)),
    onSuccess: () => {
      invalidateUserViews();
      setEditingUser(null);
      notifySuccess(text.toast.userUpdated, { origin: userFeedbackOriginRef.current });
      userFeedbackOriginRef.current = null;
    },
    onError: (error) => {
      userFeedbackOriginRef.current = null;
      toast.error(error.message);
    }
  });

  const toggleUser = useMutation({
    mutationFn: ({ user, enabled }: { user: User; enabled: boolean }) => patchJSON<User>(`/api/admin/users/${user.id}`, { enabled }),
    onSuccess: () => {
      invalidateUserViews();
      setDisableTarget(null);
      notifySuccess(text.toast.userUpdated, { origin: userFeedbackOriginRef.current });
      userFeedbackOriginRef.current = null;
    },
    onError: (error) => {
      userFeedbackOriginRef.current = null;
      toast.error(error.message);
    }
  });

  const deleteUser = useMutation({
    mutationFn: (user: User) => api(`/api/admin/users/${user.id}`, { method: 'DELETE' })
  });

  return (
    <>
      <div className="admin-table-page users-admin-page">
        <div className="admin-table-page-header">
          <div className="admin-table-page-title">
            <h1>{text.users.title}</h1>
            <p>{visibleUsers.length}/{userPage?.total ?? 0} {text.users.count}</p>
          </div>
          <button className="btn-primary admin-table-page-primary" onClick={() => setShowCreateDialog(true)}>
            <UserCog size={15} />
            {text.users.createTitle}
          </button>
        </div>

      <div className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)] users-management-grid">
        <section className="panel quota-settings-panel">
          <div className="panel-header admin-panel-header">
            <div>
              <h2>{text.admin.quotaSettings.title}<InfoTip text={text.admin.quotaSettings.desc} /></h2>
            </div>
            <button
              ref={quotaSaveButtonRef}
              className="btn-secondary"
              onClick={() => saveQuotaSettings.mutate()}
              disabled={saveQuotaSettings.isPending || quotaSettings.isError || Boolean(quotaValidationError)}
            >
              <Save size={15} />
              {text.admin.quotaSettings.save}
            </button>
          </div>
          <div className="admin-dns-settings">
            <label className="grid gap-1 text-sm">
              <span className="text-[var(--muted)]">{text.admin.quotaSettings.publicDomainMailboxLimit}<InfoTip text={text.admin.quotaSettings.publicDomainMailboxLimitHint} /></span>
              <input className="input" type="number" min="0" value={quotaForm.public_domain_mailbox_limit} onChange={(event) => { setQuotaDirty(true); setQuotaForm((current) => ({ ...current, public_domain_mailbox_limit: event.target.value })); }} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-[var(--muted)]">{text.admin.quotaSettings.userDailyPublicMailboxLimit}<InfoTip text={text.admin.quotaSettings.userDailyPublicMailboxLimitHint} /></span>
              <input className="input" type="number" min="0" value={quotaForm.user_daily_public_mailbox_limit} onChange={(event) => { setQuotaDirty(true); setQuotaForm((current) => ({ ...current, user_daily_public_mailbox_limit: event.target.value })); }} />
            </label>
            {quotaValidationError && (
              <p className="field-error" role="alert">{quotaValidationError}</p>
            )}
            <label className="grid gap-1 text-sm">
              <div className="toggle-row">
                <span className="toggle-row-label">{text.admin.quotaSettings.requirePublicDomainForQuota}<InfoTip text={text.admin.quotaSettings.requirePublicDomainForQuotaHint} /></span>
                <button
                  type="button"
                  className={`toggle-switch ${quotaForm.require_public_domain_for_quota ? 'on' : ''}`}
                  onClick={() => { setQuotaDirty(true); setQuotaForm((current) => ({ ...current, require_public_domain_for_quota: !current.require_public_domain_for_quota })); }}
                  role="switch"
                  aria-checked={quotaForm.require_public_domain_for_quota}
                >
                  <span className="toggle-switch-knob" />
                </button>
              </div>
            </label>
            <label className="grid gap-1 text-sm">
              <div className="toggle-row">
                <span className="toggle-row-label">{text.admin.quotaSettings.enableUserOnboarding}<InfoTip text={text.admin.quotaSettings.enableUserOnboardingHint} /></span>
                <button
                  type="button"
                  className={`toggle-switch ${quotaForm.enable_user_onboarding ? 'on' : ''}`}
                  onClick={() => { setQuotaDirty(true); setQuotaForm((current) => ({ ...current, enable_user_onboarding: !current.enable_user_onboarding })); }}
                  role="switch"
                  aria-checked={quotaForm.enable_user_onboarding}
                >
                  <span className="toggle-switch-knob" />
                </button>
              </div>
            </label>
          </div>
        </section>

        <section className="panel admin-table-panel users-table-panel">
          <DataTableToolbar
            className="users-table-toolbar"
            search={(
              <label className="users-search">
                <Search size={15} />
                <input value={search} onChange={(event) => setSearch(event.target.value, 'replace')} placeholder={text.users.searchPlaceholder} />
              </label>
            )}
            filters={(
              <div className="users-filters">
                <select className="input" value={roleFilter} onChange={(event) => setFilter('role', event.target.value as UserTableFilters['role'])}>
                  <option value="all">{text.users.allRoles}</option>
                  <option value="admin">{text.role.admin}</option>
                  <option value="user">{text.role.user}</option>
                </select>
                <select className="input" value={statusFilter} onChange={(event) => setFilter('status', event.target.value as UserTableFilters['status'])}>
                  <option value="all">{text.users.allStatuses}</option>
                  <option value="enabled">{text.common.enabled}</option>
                  <option value="disabled">{text.common.disabled}</option>
                </select>
              </div>
            )}
            viewOptions={(
              <DataTableViewOptions
                columns={userColumns}
                hiddenColumnKeys={hiddenColumnKeys}
                onHiddenColumnKeysChange={setHiddenColumnKeys}
                label={text.common.view}
                menuLabel={text.common.toggleColumns}
                resetLabel={text.common.reset}
                emptyLabel={text.common.noToggleColumns}
              />
            )}
          />
          <DataTable
            ariaLabel={text.users.title}
            hiddenColumnKeys={hiddenColumnKeys}
            onHiddenColumnKeysChange={setHiddenColumnKeys}
            hiddenLabel={text.common.noColumnsSelected}
            showAllColumnsLabel={text.common.showAllColumns}
            emptyLabel={text.users.empty}
            loading={users.isLoading}
            loadingLabel={text.common.loading}
            error={users.isError}
            errorLabel={users.error instanceof Error && users.error.message ? users.error.message : text.users.errorLoading}
            retryLabel={text.common.retry}
            retryPending={users.isFetching}
            onRetry={() => { void users.refetch(); }}
            columns={userColumns}
            rows={visibleUsers.flatMap((user) => {
              const expanded = expandedUserIds.includes(user.id);
              const toggleLabel = expanded ? text.users.collapseApiKeys : text.users.expandApiKeys;
              const userName = displayName(user);
              const userSubtitle = displaySubtitle(user);
              const userRow = {
                key: user.id,
                selected: expanded,
                className: expanded ? 'users-row-expanded' : undefined,
                cells: [
                  <button
                    type="button"
                    className="icon-btn users-expand-button"
                    title={`${toggleLabel}: ${user.email}`}
                    aria-label={`${toggleLabel}: ${user.email}`}
                    aria-expanded={expanded}
                    onClick={() => toggleUserApiKeys(user.id)}
                  >
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>,
                  <div className="admin-domain-cell users-email-cell">
                    <b>{userName}</b>
                    {userSubtitle && <span>{userSubtitle}</span>}
                    {user.id === currentUser.id && <small>{text.users.currentUser}</small>}
                  </div>,
                  roleText(user.role, text),
                  boolBadge(user.enabled),
                  user.daily_limit
                    ? <><b>{user.public_mailbox_today}</b><span className="usage-muted">/{user.daily_limit}</span></>
                    : <><b>{user.public_mailbox_today}</b><span className="usage-muted">/{text.users.unlimited}</span></>,
                  user.total_limit
                    ? <><b>{user.total_used}</b><span className="usage-muted">/{user.total_limit}</span></>
                    : <><b>{user.total_used}</b><span className="usage-muted">/{text.users.unlimited}</span></>,
                  user.last_used_at ? relativeTime(user.last_used_at) : '-',
                  <div className="table-actions">
                    <button className="btn-ghost" onClick={() => setEditingUser(user)}>
                      <Pencil size={14} />
                      {text.users.edit}
                    </button>
                    {user.enabled ? (
                      <button className="btn-ghost" disabled={user.id === currentUser.id || toggleUser.isPending} onClick={() => setDisableTarget(user)}>
                        <Ban size={14} />
                        {text.common.disabled}
                      </button>
                    ) : (
                      <button className="btn-ghost" disabled={toggleUser.isPending} onClick={(event) => {
                        userFeedbackOriginRef.current = event.currentTarget;
                        toggleUser.mutate({ user, enabled: true });
                      }}>
                        <CheckCircle size={14} />
                        {text.common.enabled}
                      </button>
                    )}
                    <button className="btn-ghost" disabled={user.id === currentUser.id || deleteUser.isPending} onClick={(e) => {
                      setDissolveTarget((e.currentTarget as HTMLElement).closest('tr, .data-table-mobile-card') as HTMLElement | null);
                      setDeleteTarget(user);
                    }}>
                      <Trash2 size={14} />
                      {text.common.delete}
                    </button>
                  </div>
                ]
              };
              if (!expanded) return [userRow];
              return [
                userRow,
                {
                  key: `${user.id}-api-keys`,
                  className: 'users-api-keys-detail-row',
                  cells: [
                    {
                      content: <UserApiKeysPanel user={user} />,
                      className: 'users-api-keys-detail-cell',
                      colSpan: userColumns.length
                    }
                  ]
                }
              ];
            })}
          />
          <PaginationControls
            page={userPage?.page || page}
            totalPages={userPage?.total_pages || 1}
            onPageChange={setPage}
            rowsPerPage={pageSize}
            rowsPerPageOptions={USER_PAGE_SIZE_OPTIONS}
            onRowsPerPageChange={setPageSize}
            rowsPerPageLabel={text.common.rowsPerPage}
          />
        </section>
      </div>
      </div>

      {showCreateDialog && (
        <CreateUserDialog
          isPending={create.isPending}
          onClose={() => setShowCreateDialog(false)}
          onSubmit={(form, origin) => {
            userFeedbackOriginRef.current = origin;
            create.mutate(form);
          }}
        />
      )}

      {editingUser && (
        <EditUserDialog
          currentUser={currentUser}
          user={editingUser}
          isPending={updateUser.isPending}
          onClose={() => setEditingUser(null)}
          onSubmit={(nextForm, origin) => {
            userFeedbackOriginRef.current = origin;
            updateUser.mutate({ user: editingUser, form: nextForm });
          }}
        />
      )}

      {disableTarget && (
        <ConfirmModal
          open
          title={text.users.disableTitle}
          description={[
            text.users.disableDesc,
            disableTarget.role === 'admin' ? text.users.adminWarning : '',
            disableTarget.email
          ].filter(Boolean).join('\n\n')}
          danger
          confirmText={text.common.disabled}
          cancelText={text.common.cancel}
          confirmLoading={toggleUser.isPending}
          onConfirm={(event) => {
            userFeedbackOriginRef.current = event.currentTarget;
            return toggleUser.mutateAsync({ user: disableTarget, enabled: false });
          }}
          onCancel={() => setDisableTarget(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          open
          title={text.users.deleteTitle}
          description={`${text.users.deleteDesc}\n\n${deleteTarget.email}`}
          danger
          confirmText={text.users.confirmDelete}
          cancelText={text.common.cancel}
          confirmLoading={deleteUser.isPending || deleteInFlightRef.current}
          onConfirm={async () => {
            if (deleteUser.isPending || deleteInFlightRef.current) return;
            const target = deleteTarget;
            const targetEl = dissolveTarget;
            if (!target) return;
            deleteInFlightRef.current = true;
            try {
              await deleteUser.mutateAsync(target);
              setDeleteTarget(null);
              setDissolveTarget(null);
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
              if (targetEl?.isConnected) {
                await runDeleteEffect(targetEl);
              }
              invalidateUserViews();
              notifySuccess(text.toast.userDeleted, { burst: false });
            } catch (error) {
              toast.error(error instanceof Error ? error.message : text.users.errorLoading);
            } finally {
              deleteInFlightRef.current = false;
            }
          }}
          onCancel={() => { setDeleteTarget(null); setDissolveTarget(null); }}
        />
      )}
    </>
  );
}

function UserApiKeysPanel({ user }: { user: User }) {
  const text = useText();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [revealedKeys, setRevealedKeys] = useState<Record<number, string>>({});
  const [revealing, setRevealing] = useState<{ keyId: number; action: 'view' | 'copy' } | null>(null);

  const keys = useQuery({
    queryKey: ['users', user.id, 'api-keys', page, pageSize, deferredSearch],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize)
      });
      if (deferredSearch) params.set('search', deferredSearch);
      return api<PaginatedResponse<APIKey>>(`/api/admin/users/${user.id}/api-keys?${params.toString()}`);
    },
    retry: false,
    staleTime: 30_000
  });

  const keyColumns = useMemo<DataTableColumn[]>(() => [
    { key: 'name', header: text.apiKeys.name, minWidth: '9rem', mobileTitle: true },
    { key: 'prefix', header: text.apiKeys.prefix, minWidth: '12rem', mobileSubtitle: true },
    { key: 'enabled', header: text.apiKeys.enabled, align: 'center', width: '6rem', mobileBadge: true },
    { key: 'today', header: text.apiKeys.today, align: 'center', width: '8rem', mobilePriority: 1 },
    { key: 'total', header: text.apiKeys.total, align: 'center', width: '8rem', mobilePriority: 2 },
    { key: 'expires', header: text.apiKeys.expires, width: '9rem', mobilePriority: 3 },
    { key: 'last-used', header: text.apiKeys.lastUsed, width: '8rem', mobilePriority: 4 },
    { key: 'actions', role: 'actions', header: text.apiKeys.actions, align: 'right', width: '6rem', hideable: false }
  ], [text]);

  const keyPage = keys.data;
  const visibleKeys = keyPage?.items || [];

  const revealKey = async (key: APIKey, event: MouseEvent<Element>, action: 'view' | 'copy') => {
    setRevealing({ keyId: key.id, action });
    try {
      const data = await postJSON<{ plain_key: string }>(`/api/admin/users/${user.id}/api-keys/${key.id}/reveal`, {});
      setRevealedKeys((current) => ({ ...current, [key.id]: data.plain_key }));
      if (action === 'copy') {
        await copyText(data.plain_key, {
          celebrate: true,
          event,
          label: text.apiKeys.copiedSecret,
          toastMessage: text.apiKeys.copiedSecret
        });
      } else {
        toast.success(text.users.apiKeyRevealed);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text.apiKeys.copyUnavailable);
    } finally {
      setRevealing(null);
    }
  };

  const isRevealing = (key: APIKey, action: 'view' | 'copy') => (
    revealing?.keyId === key.id && revealing.action === action
  );

  return (
    <div className="users-api-keys-detail-panel">
      <DataTableToolbar
        className="users-api-keys-toolbar"
        search={(
          <label className="users-search users-api-keys-search">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder={text.users.apiKeySearchPlaceholder}
            />
          </label>
        )}
        state={`${visibleKeys.length}/${keyPage?.total ?? 0} ${text.apiKeys.count}`}
      >
        <div className="users-api-keys-heading">
          <KeyRound size={15} />
          <span>{text.users.apiKeysTitle}</span>
          <small>{user.email}</small>
        </div>
      </DataTableToolbar>

      <DataTable
        ariaLabel={`${text.users.apiKeysTitle}: ${user.email}`}
        density="compact"
        stickyActions={false}
        columns={keyColumns}
        emptyLabel={text.apiKeys.empty}
        loading={keys.isLoading}
        loadingLabel={text.common.loading}
        error={keys.isError}
        errorLabel={keys.error instanceof Error && keys.error.message ? keys.error.message : text.users.apiKeysErrorLoading}
        retryLabel={text.common.retry}
        retryPending={keys.isFetching}
        onRetry={() => { void keys.refetch(); }}
        rows={visibleKeys.map((key) => {
          const plainKey = revealedKeys[key.id];
          return {
            key: key.id,
            cells: [
              key.name,
              <div className="users-api-key-secret">
                <code>{key.key_prefix}</code>
                {plainKey && <code className="users-api-key-secret-full">{plainKey}</code>}
              </div>,
              boolBadge(key.enabled),
              <QuotaThermometer used={key.used_today} limit={key.daily_limit} />,
              <QuotaThermometer used={key.total_used} limit={key.total_limit} />,
              formatAPIKeyExpiry(key.expires_at),
              key.last_used_at ? relativeTime(key.last_used_at) : '-',
              <div className="table-actions users-api-key-actions">
                <IconButton
                  title={`${text.users.viewApiKey}: ${key.name}`}
                  onClick={(event) => revealKey(key, event, 'view')}
                  disabled={Boolean(revealing)}
                >
                  {isRevealing(key, 'view') ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                </IconButton>
                <IconButton
                  title={`${text.apiKeys.copySecret}: ${key.name}`}
                  onClick={(event) => revealKey(key, event, 'copy')}
                  disabled={Boolean(revealing)}
                >
                  {isRevealing(key, 'copy') ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                </IconButton>
              </div>
            ]
          };
        })}
      />
      <PaginationControls
        className="users-api-keys-pagination"
        page={keyPage?.page || page}
        totalPages={keyPage?.total_pages || 1}
        onPageChange={setPage}
        rowsPerPage={pageSize}
        rowsPerPageOptions={USER_API_KEY_PAGE_SIZE_OPTIONS}
        onRowsPerPageChange={(nextPageSize) => {
          setPageSize(nextPageSize);
          setPage(1);
        }}
        rowsPerPageLabel={text.common.rowsPerPage}
      />
    </div>
  );
}

function validateQuotaForm(form: {
  public_domain_mailbox_limit: string;
  user_daily_public_mailbox_limit: string;
}) {
  return isNonNegativeIntegerInput(form.public_domain_mailbox_limit) &&
    isNonNegativeIntegerInput(form.user_daily_public_mailbox_limit)
    ? ''
    : INVALID_QUOTA_MESSAGE;
}

function parseNonNegativeInteger(value: string) {
  if (!isNonNegativeIntegerInput(value)) throw new Error(INVALID_QUOTA_MESSAGE);
  return Number.parseInt(value.trim(), 10);
}

function isNonNegativeIntegerInput(value: string) {
  return /^\d+$/.test(value.trim());
}

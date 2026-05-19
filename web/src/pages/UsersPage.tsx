import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle, Pencil, Save, Search, Trash2, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import type { PaginatedResponse, SystemQuotaSettings, User } from '../api';
import { api, patchJSON, postJSON } from '../api';
import { roleText, useText } from '../locales';
import { notifySuccess, runDeleteEffect } from '../lib/feedback';
import { boolBadge, relativeTime } from '../lib/display';
import { ConfirmModal, DataTable, InfoTip, PaginationControls } from '../components/shared';
import { CreateUserDialog } from './CreateUserDialog';
import { EditUserDialog } from './EditUserDialog';
import { type UserForm, buildCreatePayload, buildUpdatePayload } from './userFormHelpers';

const USER_PAGE_SIZE = 20;

export function UsersPage({ currentUser }: { currentUser: User }) {
  const queryClient = useQueryClient();
  const text = useText();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | User['role']>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [disableTarget, setDisableTarget] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [dissolveTarget, setDissolveTarget] = useState<HTMLElement | null>(null);
  const quotaSaveButtonRef = useRef<HTMLButtonElement | null>(null);
  const userFeedbackOriginRef = useRef<HTMLElement | null>(null);
  const users = useQuery({
    queryKey: ['users', page, search.trim(), roleFilter, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(USER_PAGE_SIZE)
      });
      const term = search.trim();
      if (term) params.set('search', term);
      if (roleFilter !== 'all') params.set('role', roleFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      return api<PaginatedResponse<User>>(`/api/users?${params.toString()}`);
    },
    retry: false,
    staleTime: 30_000
  });
  const userPage = users.data;
  const visibleUsers = userPage?.items || [];

  const invalidateUserViews = () => {
    queryClient.invalidateQueries({ queryKey: ['users'] });
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    queryClient.invalidateQueries({ queryKey: ['admin-quota-alerts'] });
    queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] });
  };

  const create = useMutation({
    mutationFn: (form: UserForm) => postJSON<User>('/api/users', buildCreatePayload(form)),
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
    queryKey: ['admin-quota-settings'],
    queryFn: () => api<SystemQuotaSettings>('/api/admin/quota-settings'),
    retry: false,
    staleTime: 30_000
  });
  const [quotaForm, setQuotaForm] = useState({
    public_domain_mailbox_limit: '0',
    user_daily_public_mailbox_limit: '0',
    require_public_domain_for_quota: false
  });
  useEffect(() => {
    const qs = quotaSettings.data;
    if (!qs) return;
    setQuotaForm({
      public_domain_mailbox_limit: String(qs.public_domain_mailbox_limit),
      user_daily_public_mailbox_limit: String(qs.user_daily_public_mailbox_limit),
      require_public_domain_for_quota: qs.require_public_domain_for_quota
    });
  }, [quotaSettings.data]);

  const saveQuotaSettings = useMutation({
    mutationFn: () => patchJSON<SystemQuotaSettings>('/api/admin/quota-settings', {
      public_domain_mailbox_limit: toPositiveInt64(quotaForm.public_domain_mailbox_limit, 0),
      user_daily_public_mailbox_limit: toPositiveInt64(quotaForm.user_daily_public_mailbox_limit, 0),
      require_public_domain_for_quota: quotaForm.require_public_domain_for_quota
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-quota-settings'] });
      notifySuccess(text.admin.quotaSettings.saved, { origin: quotaSaveButtonRef.current });
    },
    onError: (error) => toast.error(error.message)
  });

  const updateUser = useMutation({
    mutationFn: ({ user, form }: { user: User; form: UserForm }) => patchJSON<User>(`/api/users/${user.id}`, buildUpdatePayload(form)),
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
    mutationFn: ({ user, enabled }: { user: User; enabled: boolean }) => patchJSON<User>(`/api/users/${user.id}`, { enabled }),
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
    mutationFn: (user: User) => api(`/api/users/${user.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateUserViews();
      setDeleteTarget(null);
      notifySuccess(text.toast.userDeleted, { burst: false });
    },
    onError: (error) => toast.error(error.message)
  });

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[22rem_1fr]">
        <section className="panel">
          <div className="panel-header admin-panel-header">
            <div>
              <h2>{text.admin.quotaSettings.title}<InfoTip text={text.admin.quotaSettings.desc} /></h2>
            </div>
            <button
              ref={quotaSaveButtonRef}
              className="btn-secondary"
              onClick={() => saveQuotaSettings.mutate()}
              disabled={saveQuotaSettings.isPending || quotaSettings.isError}
            >
              <Save size={15} />
              {text.admin.quotaSettings.save}
            </button>
          </div>
          <div className="admin-dns-settings">
            <label className="grid gap-1 text-sm">
              <span className="text-[var(--muted)]">{text.admin.quotaSettings.publicDomainMailboxLimit}<InfoTip text={text.admin.quotaSettings.publicDomainMailboxLimitHint} /></span>
              <input className="input" type="number" min="0" value={quotaForm.public_domain_mailbox_limit} onChange={(event) => setQuotaForm((current) => ({ ...current, public_domain_mailbox_limit: event.target.value }))} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-[var(--muted)]">{text.admin.quotaSettings.userDailyPublicMailboxLimit}<InfoTip text={text.admin.quotaSettings.userDailyPublicMailboxLimitHint} /></span>
              <input className="input" type="number" min="0" value={quotaForm.user_daily_public_mailbox_limit} onChange={(event) => setQuotaForm((current) => ({ ...current, user_daily_public_mailbox_limit: event.target.value }))} />
            </label>
            <label className="grid gap-1 text-sm">
              <div className="toggle-row">
                <span className="toggle-row-label">{text.admin.quotaSettings.requirePublicDomainForQuota}<InfoTip text={text.admin.quotaSettings.requirePublicDomainForQuotaHint} /></span>
                <button
                  type="button"
                  className={`toggle-switch ${quotaForm.require_public_domain_for_quota ? 'on' : ''}`}
                  onClick={() => setQuotaForm((current) => ({ ...current, require_public_domain_for_quota: !current.require_public_domain_for_quota }))}
                  role="switch"
                  aria-checked={quotaForm.require_public_domain_for_quota}
                >
                  <span className="toggle-switch-knob" />
                </button>
              </div>
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header users-panel-header users-panel-header-stack">
            <div className="users-panel-title-row">
              <div>
                <h2>{text.users.title}</h2>
                <p>{visibleUsers.length}/{userPage?.total ?? 0} {text.users.count}</p>
              </div>
              <button className="btn-primary" onClick={() => setShowCreateDialog(true)}>
                <UserCog size={15} />
                {text.users.createTitle}
              </button>
            </div>
            <div className="users-filters">
              <label className="users-search">
                <Search size={15} />
                <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={text.users.searchPlaceholder} />
              </label>
              <select className="input" value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value as typeof roleFilter); setPage(1); }}>
                <option value="all">{text.users.allRoles}</option>
                <option value="admin">{text.role.admin}</option>
                <option value="user">{text.role.user}</option>
              </select>
              <select className="input" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); setPage(1); }}>
                <option value="all">{text.users.allStatuses}</option>
                <option value="enabled">{text.common.enabled}</option>
                <option value="disabled">{text.common.disabled}</option>
              </select>
            </div>
          </div>
          <DataTable
            ariaLabel={text.users.title}
            emptyLabel={
              users.isLoading ? text.common.loading
              : users.isError ? text.users.errorLoading
              : text.users.empty
            }
            columns={[
              { key: 'email', header: text.users.email, minWidth: '15rem' },
              { key: 'role', header: text.users.role, width: '7rem' },
              { key: 'enabled', header: text.users.enabled, align: 'center', width: '6rem' },
              { key: 'today-usage', header: text.users.todayUsage, align: 'right', width: '8rem' },
              { key: 'total-usage', header: text.users.totalUsage, align: 'right', width: '8rem' },
              { key: 'last-used', header: text.users.lastUsed, width: '8rem' },
              { key: 'actions', header: text.users.actions, align: 'right', minWidth: '15rem' }
            ]}
            rows={visibleUsers.map((user) => ({
              key: user.id,
              cells: [
                <div className="admin-domain-cell users-email-cell">
                  <b>{user.email}</b>
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
                    setDissolveTarget((e.currentTarget as HTMLElement).closest('tr'));
                    setDeleteTarget(user);
                  }}>
                    <Trash2 size={14} />
                    {text.common.delete}
                  </button>
                </div>
              ]
            }))}
          />
          <PaginationControls page={userPage?.page || page} totalPages={userPage?.total_pages || 1} onPageChange={setPage} />
        </section>
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
          onConfirm={(event) => {
            userFeedbackOriginRef.current = event.currentTarget;
            toggleUser.mutate({ user: disableTarget, enabled: false });
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
          onConfirm={async () => {
            const target = deleteTarget;
            const targetEl = dissolveTarget;
            setDeleteTarget(null);
            setDissolveTarget(null);
            await new Promise(r => requestAnimationFrame(r));
            if (targetEl) {
              await runDeleteEffect(targetEl);
            }
            deleteUser.mutate(target);
          }}
          onCancel={() => { setDeleteTarget(null); setDissolveTarget(null); }}
        />
      )}
    </>
  );
}

function toPositiveInt64(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

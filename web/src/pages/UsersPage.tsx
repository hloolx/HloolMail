import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Search, Trash2, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import type { User } from '../api';
import { api, patchJSON, postJSON } from '../api';
import { roleText, useText } from '../locales';
import { dissolveElement } from '../lib/dissolve';
import { boolBadge, relativeTime } from '../lib/display';
import { ConfirmModal, DataTable, IconButton } from '../components/shared';
import { EditUserDialog } from './EditUserDialog';
import { type UserForm, buildCreatePayload, buildUpdatePayload, emptyCreateForm, validateEmail } from './userFormHelpers';

export function UsersPage({ currentUser }: { currentUser: User }) {
  const queryClient = useQueryClient();
  const text = useText();
  const [form, setForm] = useState<UserForm>(emptyCreateForm());
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | User['role']>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [disableTarget, setDisableTarget] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [dissolveTarget, setDissolveTarget] = useState<HTMLElement | null>(null);
  const [emailError, setEmailError] = useState('');
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/api/users'), retry: false, staleTime: 30_000 });

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (users.data || []).filter((user) => {
      const matchesSearch = !term || user.email.toLowerCase().includes(term);
      const matchesRole = roleFilter === 'all' || user.role === roleFilter;
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'enabled' ? user.enabled : !user.enabled);
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [roleFilter, search, statusFilter, users.data]);

  const invalidateUserViews = () => {
    queryClient.invalidateQueries({ queryKey: ['users'] });
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    queryClient.invalidateQueries({ queryKey: ['admin-quota-alerts'] });
    queryClient.invalidateQueries({ queryKey: ['admin-audit-logs'] });
  };

  const create = useMutation({
    mutationFn: () => postJSON<User>('/api/users', buildCreatePayload(form)),
    onSuccess: () => {
      invalidateUserViews();
      setForm(emptyCreateForm());
      setEmailError('');
      toast.success(text.toast.userCreated);
    },
    onError: (error) => toast.error(error.message)
  });

  const updateUser = useMutation({
    mutationFn: ({ user, form }: { user: User; form: UserForm }) => patchJSON<User>(`/api/users/${user.id}`, buildUpdatePayload(form)),
    onSuccess: () => {
      invalidateUserViews();
      setEditingUser(null);
      toast.success(text.toast.userUpdated);
    },
    onError: (error) => toast.error(error.message)
  });

  const toggleUser = useMutation({
    mutationFn: ({ user, enabled }: { user: User; enabled: boolean }) => patchJSON<User>(`/api/users/${user.id}`, { enabled }),
    onSuccess: () => {
      invalidateUserViews();
      setDisableTarget(null);
      toast.success(text.toast.userUpdated);
    },
    onError: (error) => toast.error(error.message)
  });

  const deleteUser = useMutation({
    mutationFn: (user: User) => api(`/api/users/${user.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateUserViews();
      setDeleteTarget(null);
      toast.success(text.toast.userDeleted);
    },
    onError: (error) => toast.error(error.message)
  });

  const set = (key: keyof UserForm, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === 'email') {
      setEmailError(validateEmail(value as string, text));
    }
  };

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[22rem_1fr]">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>{text.users.createTitle}</h2>
              <p>{text.users.desc}</p>
            </div>
          </div>
          <form className="user-form" onSubmit={(event) => {
            event.preventDefault();
            if (!create.isPending) create.mutate();
          }}>
            <label className="user-form-field">
              <span>{text.users.email}</span>
              <input className="input" value={form.email} onChange={(event) => set('email', event.target.value)} placeholder="user@example.com" />
              {emailError && <span className="field-error">{emailError}</span>}
            </label>
            <label className="user-form-field">
              <span>{text.users.password}</span>
              <input className="input" value={form.password} onChange={(event) => set('password', event.target.value)} placeholder={text.users.passwordPlaceholder} type="password" />
            </label>
            <label className="user-form-field">
              <span>{text.users.role}</span>
              <select className="input" value={form.role} onChange={(event) => set('role', event.target.value as User['role'])}>
                <option value="user">{text.role.user}</option>
                <option value="admin">{text.role.admin}</option>
              </select>
            </label>
            <div className="user-limit-grid">
              <label className="user-form-field">
                <span>{text.users.dailyLimit}</span>
                <input className="input" type="number" min={0} value={form.daily_limit} onChange={(event) => set('daily_limit', event.target.value)} />
                <small className="field-hint">{text.users.dailyLimitHint}</small>
              </label>
              <label className="user-form-field">
                <span>{text.users.totalLimit}</span>
                <input className="input" type="number" min={0} value={form.total_limit} onChange={(event) => set('total_limit', event.target.value)} />
                <small className="field-hint">{text.users.totalLimitHint}</small>
              </label>
            </div>
            <p className="user-form-note">{text.users.quotaNote}</p>
            <button className="btn-primary" type="submit" disabled={create.isPending}>
              {create.isPending ? <Loader2 size={16} className="animate-spin" /> : <UserCog size={16} />}
              {text.users.createTitle}
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="panel-header users-panel-header">
            <div>
              <h2>{text.users.title}</h2>
              <p>{filteredUsers.length}/{users.data?.length ?? 0} {text.users.count}</p>
            </div>
            <div className="users-filters">
              <label className="users-search">
                <Search size={15} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={text.users.searchPlaceholder} />
              </label>
              <select className="input" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}>
                <option value="all">{text.users.allRoles}</option>
                <option value="admin">{text.role.admin}</option>
                <option value="user">{text.role.user}</option>
              </select>
              <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
                <option value="all">{text.users.allStatuses}</option>
                <option value="enabled">{text.common.enabled}</option>
                <option value="disabled">{text.common.disabled}</option>
              </select>
            </div>
          </div>
          <DataTable
            emptyLabel={
              users.isLoading ? text.common.loading
              : users.isError ? text.users.errorLoading
              : text.users.empty
            }
            columns={[
              { key: 'email', header: text.users.email },
              { key: 'role', header: text.users.role },
              { key: 'enabled', header: text.users.enabled },
              { key: 'today-usage', header: text.users.todayUsage },
              { key: 'total-usage', header: text.users.totalUsage },
              { key: 'last-used', header: text.users.lastUsed },
              { key: 'actions', header: text.users.actions }
            ]}
            rows={filteredUsers.map((user) => ({
              key: user.id,
              cells: [
                <div className="admin-domain-cell">
                  <b>{user.email}</b>
                  {user.id === currentUser.id && <small>{text.users.currentUser}</small>}
                </div>,
                roleText(user.role, text),
                boolBadge(user.enabled),
                user.daily_limit
                  ? <><b>{user.used_today}</b><span className="usage-muted">/{user.daily_limit}</span></>
                  : <><b>{user.used_today}</b><span className="usage-muted">/{text.users.unlimited}</span></>,
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
                      {text.common.disabled}
                    </button>
                  ) : (
                    <button className="btn-ghost" disabled={toggleUser.isPending} onClick={() => toggleUser.mutate({ user, enabled: true })}>
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
        </section>
      </div>

      {editingUser && (
        <EditUserDialog
          currentUser={currentUser}
          user={editingUser}
          isPending={updateUser.isPending}
          onClose={() => setEditingUser(null)}
          onSubmit={(nextForm) => updateUser.mutate({ user: editingUser, form: nextForm })}
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
          onConfirm={() => toggleUser.mutate({ user: disableTarget, enabled: false })}
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
              try {
                await dissolveElement(targetEl, { duration: 400, blockSize: 4, direction: 'out' });
              } catch {
                // dissolve failed, proceed with mutation anyway
              }
            }
            deleteUser.mutate(target);
          }}
          onCancel={() => { setDeleteTarget(null); setDissolveTarget(null); }}
        />
      )}
    </>
  );
}

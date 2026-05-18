import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Pencil, Search, ShieldAlert, Trash2, UserCog, X } from 'lucide-react';
import { toast } from 'sonner';
import type { User } from '../api';
import { api, patchJSON, postJSON } from '../api';
import { roleText, useText } from '../locales';
import { boolBadge, relativeTime } from '../lib/display';
import { DataTable, IconButton } from '../components/shared';

type UserForm = {
  email: string;
  password: string;
  role: User['role'];
  enabled: boolean;
  daily_limit: string;
  total_limit: string;
};

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
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/api/users'), retry: false });

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
      toast.success('用户已删除');
    },
    onError: (error) => toast.error(error.message)
  });

  const set = (key: keyof UserForm, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

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
            </label>
            <label className="user-form-field">
              <span>密码</span>
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
                <span>日额度</span>
                <input className="input" type="number" min={0} value={form.daily_limit} onChange={(event) => set('daily_limit', event.target.value)} />
              </label>
              <label className="user-form-field">
                <span>总额度</span>
                <input className="input" type="number" min={0} value={form.total_limit} onChange={(event) => set('total_limit', event.target.value)} />
              </label>
            </div>
            <p className="user-form-note">额度填 0 表示不限制；普通用户生成邮箱会消耗额度，管理员不消耗。</p>
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
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索邮箱" />
              </label>
              <select className="input" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}>
                <option value="all">全部角色</option>
                <option value="admin">{text.role.admin}</option>
                <option value="user">{text.role.user}</option>
              </select>
              <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
                <option value="all">全部状态</option>
                <option value="enabled">{text.common.enabled}</option>
                <option value="disabled">{text.common.disabled}</option>
              </select>
            </div>
          </div>
          <DataTable
            emptyLabel={users.isLoading ? '加载中...' : '暂无用户'}
            columns={[
              { key: 'email', header: text.users.email },
              { key: 'role', header: text.users.role },
              { key: 'enabled', header: text.users.enabled },
              { key: 'today-usage', header: text.users.todayUsage },
              { key: 'total-usage', header: text.users.totalUsage },
              { key: 'last-used', header: text.users.lastUsed },
              { key: 'actions', header: '操作' }
            ]}
            rows={filteredUsers.map((user) => ({
              key: user.id,
              cells: [
                <div className="admin-domain-cell">
                  <b>{user.email}</b>
                  {user.id === currentUser.id && <small>当前账号</small>}
                </div>,
                roleText(user.role, text),
                boolBadge(user.enabled),
                user.daily_limit ? `${user.used_today}/${user.daily_limit}` : `${user.used_today}/不限`,
                user.total_limit ? `${user.total_used}/${user.total_limit}` : `${user.total_used}/不限`,
                user.last_used_at ? relativeTime(user.last_used_at) : '-',
                <div className="table-actions">
                  <button className="btn-ghost" onClick={() => setEditingUser(user)}>
                    <Pencil size={14} />
                    编辑
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
                  <button className="btn-ghost" disabled={user.id === currentUser.id || deleteUser.isPending} onClick={() => setDeleteTarget(user)}>
                    <Trash2 size={14} />
                    删除
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
        <ConfirmDisableUserDialog
          user={disableTarget}
          isPending={toggleUser.isPending}
          onClose={() => setDisableTarget(null)}
          onConfirm={() => toggleUser.mutate({ user: disableTarget, enabled: false })}
        />
      )}

      {deleteTarget && (
        <ConfirmDeleteUserDialog
          user={deleteTarget}
          isPending={deleteUser.isPending}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteUser.mutate(deleteTarget)}
        />
      )}
    </>
  );
}

function EditUserDialog({ currentUser, user, isPending, onClose, onSubmit }: { currentUser: User; user: User; isPending: boolean; onClose: () => void; onSubmit: (form: UserForm) => void }) {
  const text = useText();
  const [form, setForm] = useState<UserForm>(() => formFromUser(user));
  const isSelf = currentUser.id === user.id;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const set = (key: keyof UserForm, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isPending) onSubmit(form);
  };

  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-panel user-edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-user-title">
        <div className="modal-header">
          <div>
            <h2 id="edit-user-title">编辑用户</h2>
            <p>{user.email}</p>
          </div>
          <IconButton title="关闭" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <form className="user-form" onSubmit={submit}>
          <label className="user-form-field">
            <span>{text.users.email}</span>
            <input className="input" value={form.email} onChange={(event) => set('email', event.target.value)} />
          </label>
          <label className="user-form-field">
            <span>新密码</span>
            <input className="input" value={form.password} onChange={(event) => set('password', event.target.value)} placeholder="留空则不修改" type="password" />
          </label>
          <div className="user-limit-grid">
            <label className="user-form-field">
              <span>{text.users.role}</span>
              <select className="input" value={form.role} disabled={isSelf} onChange={(event) => set('role', event.target.value as User['role'])}>
                <option value="user">{text.role.user}</option>
                <option value="admin">{text.role.admin}</option>
              </select>
            </label>
            <label className="check-row user-enabled-row">
              <input type="checkbox" checked={form.enabled} disabled={isSelf} onChange={(event) => set('enabled', event.target.checked)} />
              {text.users.enabled}
            </label>
          </div>
          <div className="user-limit-grid">
            <label className="user-form-field">
              <span>日额度</span>
              <input className="input" type="number" min={0} value={form.daily_limit} onChange={(event) => set('daily_limit', event.target.value)} />
            </label>
            <label className="user-form-field">
              <span>总额度</span>
              <input className="input" type="number" min={0} value={form.total_limit} onChange={(event) => set('total_limit', event.target.value)} />
            </label>
          </div>
          {isSelf && <p className="user-form-note">当前账号不能在这里被禁用或降权，避免把自己锁在门外。</p>}
          <div className="modal-actions">
            <button className="btn-secondary" type="button" onClick={onClose}>取消</button>
            <button className="btn-primary" type="submit" disabled={isPending}>
              {isPending && <Loader2 size={16} className="animate-spin" />}
              保存
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body
  );
}

function ConfirmDisableUserDialog({ user, isPending, onClose, onConfirm }: { user: User; isPending: boolean; onClose: () => void; onConfirm: () => void }) {
  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-panel confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="disable-user-title" aria-describedby="disable-user-desc">
        <div className="confirm-modal-icon"><ShieldAlert size={18} /></div>
        <div className="confirm-modal-copy">
          <h2 id="disable-user-title">禁用用户</h2>
          <p id="disable-user-desc">禁用后该用户无法登录，绑定的 API Key 也会因为 owner 不可用而拒绝访问。</p>
          <code>{user.email}</code>
        </div>
        <div className="confirm-modal-actions">
          <button className="btn-secondary" onClick={onClose}>取消</button>
          <button className="btn-danger" onClick={onConfirm} disabled={isPending}>
            {isPending && <Loader2 size={16} className="animate-spin" />}
            禁用
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}

function ConfirmDeleteUserDialog({ user, isPending, onClose, onConfirm }: { user: User; isPending: boolean; onClose: () => void; onConfirm: () => void }) {
  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-panel confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-user-title" aria-describedby="delete-user-desc">
        <div className="confirm-modal-icon"><AlertTriangle size={18} /></div>
        <div className="confirm-modal-copy">
          <h2 id="delete-user-title">删除用户</h2>
          <p id="delete-user-desc">删除后该用户及关联数据将被永久移除，此操作不可撤销。仅建议在 GDPR 合规要求或用户主动请求时执行。</p>
          <code>{user.email}</code>
        </div>
        <div className="confirm-modal-actions">
          <button className="btn-secondary" onClick={onClose}>取消</button>
          <button className="btn-danger" onClick={onConfirm} disabled={isPending}>
            {isPending && <Loader2 size={16} className="animate-spin" />}
            确认删除
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}

function emptyCreateForm(): UserForm {
  return { email: '', password: '', role: 'user', enabled: true, daily_limit: '1000', total_limit: '0' };
}

function formFromUser(user: User): UserForm {
  return {
    email: user.email,
    password: '',
    role: user.role,
    enabled: user.enabled,
    daily_limit: String(user.daily_limit ?? 0),
    total_limit: String(user.total_limit ?? 0)
  };
}

function buildCreatePayload(form: UserForm) {
  const payload = buildBasePayload(form);
  if (form.password.length < 8) throw new Error('密码至少 8 位');
  return { ...payload, password: form.password };
}

function buildUpdatePayload(form: UserForm) {
  const payload = buildBasePayload(form) as Record<string, unknown>;
  if (form.password.trim()) {
    if (form.password.length < 8) throw new Error('密码至少 8 位');
    payload.password = form.password;
  }
  return payload;
}

function buildBasePayload(form: UserForm) {
  const email = form.email.trim().toLowerCase();
  if (!email.includes('@')) throw new Error('请输入有效邮箱');
  const daily = parseQuota(form.daily_limit, '日额度');
  const total = parseQuota(form.total_limit, '总额度');
  return {
    email,
    role: form.role,
    enabled: form.enabled,
    daily_limit: daily,
    total_limit: total
  };
}

function parseQuota(value: string, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label}必须是 0 或正整数`);
  return parsed;
}

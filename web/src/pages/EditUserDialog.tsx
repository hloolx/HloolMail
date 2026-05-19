import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import type { User } from '../api';
import { useText } from '../locales';
import { IconButton } from '../components/shared';
import { type UserForm, formFromUser, validateEmail } from './userFormHelpers';

export function EditUserDialog({
  currentUser,
  user,
  isPending,
  onClose,
  onSubmit
}: {
  currentUser: User;
  user: User;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (form: UserForm) => void;
}) {
  const text = useText();
  const [form, setForm] = useState<UserForm>(() => formFromUser(user));
  const [emailError, setEmailError] = useState('');
  const isSelf = currentUser.id === user.id;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const set = (key: keyof UserForm, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === 'email') {
      setEmailError(validateEmail(value as string, text));
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isPending) onSubmit(form);
  };

  return createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-panel user-edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-user-title">
        <div className="modal-header">
          <div>
            <h2 id="edit-user-title">{text.users.editTitle}</h2>
            <p>{user.email}</p>
          </div>
          <IconButton title={text.common.close} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <form className="user-form" onSubmit={submit}>
          <label className="user-form-field">
            <span>{text.users.email}</span>
            <input className="input" value={form.email} onChange={(event) => set('email', event.target.value)} />
            {emailError && <span className="field-error">{emailError}</span>}
          </label>
          <label className="user-form-field">
            <span>{text.users.newPassword}</span>
            <input className="input" value={form.password} onChange={(event) => set('password', event.target.value)} placeholder={text.users.passwordPlaceholderEdit} type="password" />
          </label>
          <label className="user-form-field">
            <span>{text.users.role}</span>
            <select className="input" value={form.role} disabled={isSelf} onChange={(event) => set('role', event.target.value as User['role'])}>
              <option value="user">{text.role.user}</option>
              <option value="admin">{text.role.admin}</option>
            </select>
          </label>
          <div className="segmented-control">
            <button type="button" className={`segment-choice ${!form.enabled ? 'segment-choice-active' : ''}`} disabled={isSelf} onClick={() => set('enabled', false)}>
              {text.common.disabled}
            </button>
            <button type="button" className={`segment-choice ${form.enabled ? 'segment-choice-active' : ''}`} disabled={isSelf} onClick={() => set('enabled', true)}>
              {text.users.enabled}
            </button>
          </div>
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
          {isSelf && <p className="user-form-note">{text.users.selfEditNote}</p>}
          <div className="modal-actions">
            <button className="btn-secondary" type="button" onClick={onClose}>{text.common.cancel}</button>
            <button className="btn-primary" type="submit" disabled={isPending}>
              {isPending && <Loader2 size={16} className="animate-spin" />}
              {text.users.save}
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body
  );
}

import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { X } from 'lucide-react';
import type { User } from '../api';
import { useText } from '../locales';
import { DialogShell, IconButton, InfoTip, LoadingIndicator } from '../components/shared';
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
  onSubmit: (form: UserForm, origin: HTMLElement | null) => void;
}) {
  const text = useText();
  const [form, setForm] = useState<UserForm>(() => formFromUser(user));
  const [emailError, setEmailError] = useState('');
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const isSelf = currentUser.id === user.id;

  const set = (key: keyof UserForm, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === 'email') {
      setEmailError(validateEmail(value as string, text));
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isPending) onSubmit(form, submitButtonRef.current);
  };

  return (
    <DialogShell
      className="modal-panel user-edit-modal"
      titleId="edit-user-title"
      descriptionId="edit-user-desc"
      onClose={onClose}
      initialFocusRef={emailInputRef}
    >
        <div className="modal-header">
          <div>
            <h2 id="edit-user-title">{text.users.editTitle}</h2>
            <p id="edit-user-desc">{user.email}</p>
          </div>
          <IconButton title={text.common.close} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <form className="user-form" onSubmit={submit}>
          <label className="user-form-field">
            <span>{text.users.email}</span>
            <input ref={emailInputRef} className="input" value={form.email} onChange={(event) => set('email', event.target.value)} />
            {emailError && <span className="field-error">{emailError}</span>}
          </label>
          <label className="user-form-field">
            <span>{text.users.nickname}</span>
            <input className="input" value={form.nickname} onChange={(event) => set('nickname', event.target.value)} placeholder={text.users.nicknamePlaceholder} autoComplete="nickname" />
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
          <div className="toggle-row">
            <span className="toggle-row-label">{text.users.enabled}</span>
            <button
              type="button"
              className={`toggle-switch ${form.enabled ? 'on' : ''}`}
              disabled={isSelf}
              onClick={() => set('enabled', !form.enabled)}
              role="switch"
              aria-checked={form.enabled}
            >
              <span className="toggle-switch-knob" />
            </button>
          </div>
          <div className="user-limit-grid">
            <label className="user-form-field">
              <span>{text.users.dailyLimit}<InfoTip text={text.users.dailyLimitHint} /></span>
              <input className="input" type="number" min={0} value={form.daily_limit} onChange={(event) => set('daily_limit', event.target.value)} />
            </label>
            <label className="user-form-field">
              <span>{text.users.totalLimit}<InfoTip text={text.users.totalLimitHint} /></span>
              <input className="input" type="number" min={0} value={form.total_limit} onChange={(event) => set('total_limit', event.target.value)} />
            </label>
          </div>
          {isSelf && <div className="flex items-center gap-1"><InfoTip text={text.users.selfEditNote} /></div>}
          <div className="modal-actions">
            <button className="btn-secondary" type="button" onClick={onClose}>{text.common.cancel}</button>
            <button ref={submitButtonRef} className="btn-primary" type="submit" disabled={isPending}>
              {isPending && <LoadingIndicator />}
              {text.users.save}
            </button>
          </div>
        </form>
    </DialogShell>
  );
}

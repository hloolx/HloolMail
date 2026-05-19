import { currentText } from '../locales';
import type { User } from '../api';

export type UserForm = {
  email: string;
  password: string;
  role: User['role'];
  enabled: boolean;
  daily_limit: string;
  total_limit: string;
};

export function validateEmail(email: string, text: ReturnType<typeof currentText>): string {
  if (!email.trim()) return text.users.emailInvalid;
  if (!email.includes('@')) return text.users.emailInvalid;
  return '';
}

export function emptyCreateForm(): UserForm {
  return { email: '', password: '', role: 'user', enabled: true, daily_limit: '1000', total_limit: '0' };
}

export function formFromUser(user: User): UserForm {
  return {
    email: user.email,
    password: '',
    role: user.role,
    enabled: user.enabled,
    daily_limit: String(user.daily_limit ?? 0),
    total_limit: String(user.total_limit ?? 0)
  };
}

export function buildCreatePayload(form: UserForm) {
  const text = currentText();
  const payload = buildBasePayload(form);
  if (form.password.length < 8) throw new Error(text.users.passwordTooShort);
  return { ...payload, password: form.password };
}

export function buildUpdatePayload(form: UserForm) {
  const text = currentText();
  const payload = buildBasePayload(form) as Record<string, unknown>;
  if (form.password.trim()) {
    if (form.password.length < 8) throw new Error(text.users.passwordTooShort);
    payload.password = form.password;
  }
  return payload;
}

function buildBasePayload(form: UserForm) {
  const text = currentText();
  const email = form.email.trim().toLowerCase();
  if (!email.includes('@')) throw new Error(text.users.emailInvalid);
  const daily = parseQuota(form.daily_limit, text.users.dailyLimit);
  const total = parseQuota(form.total_limit, text.users.totalLimit);
  return {
    email,
    role: form.role,
    enabled: form.enabled,
    daily_limit: daily,
    total_limit: total
  };
}

function parseQuota(value: string, label: string) {
  const text = currentText();
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(text.users.quotaInvalid.replace('{label}', label));
  return parsed;
}

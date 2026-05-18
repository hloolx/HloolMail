import type { User } from '../api';
import type { Language } from '../store';
import { useAppStore } from '../store';
import zhCN from './zh-CN';
import enUS from './en-US';

const copyByLanguage: Record<Language, typeof zhCN> = {
  'zh-CN': zhCN,
  'en-US': enUS
};

export function useText() {
  const language = useAppStore((state) => state.language);
  return copyByLanguage[language];
}

export function currentText(language?: Language) {
  return copyByLanguage[language ?? useAppStore.getState().language];
}

export function roleText(role: User['role'], text = currentText()) {
  return role === 'admin' ? text.role.admin : text.role.user;
}

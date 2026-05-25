import type { User } from '../api';

export const MAX_NICKNAME_LENGTH = 40;

export type NicknameValidationMessages = {
  required: string;
  tooLong: string;
  invalid: string;
};

export function normalizeNicknameInput(value: string) {
  return value.trim();
}

export function validateNicknameInput(value: string, messages: NicknameValidationMessages) {
  const nickname = normalizeNicknameInput(value);
  if (!nickname) return messages.required;
  if (Array.from(nickname).length > MAX_NICKNAME_LENGTH) return messages.tooLong;
  if (hasControlCharacter(nickname)) return messages.invalid;
  return '';
}

type DisplayUser = Pick<User, 'email'> & {
  nickname?: User['nickname'] | null;
};

function hasControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f));
  });
}

export function displayName(user: DisplayUser) {
  return normalizeNicknameInput(user.nickname || '') || user.email;
}

export function displaySubtitle(user: DisplayUser) {
  const nickname = normalizeNicknameInput(user.nickname || '');
  return nickname ? user.email : '';
}

export function displayInitial(user: DisplayUser) {
  const source = displayName(user).trim();
  return source ? Array.from(source)[0].toLocaleUpperCase() : '?';
}

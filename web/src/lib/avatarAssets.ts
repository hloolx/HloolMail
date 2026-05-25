import type { User } from '../api';
import { displayName } from './userDisplay';

const DEFAULT_AVATAR_BASE_PATH = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/avatars/defaults`;
const DEFAULT_AVATAR_KEYS = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
  'u',
  'v',
  'w',
  'x',
  'y',
  'z'
] as const;

type DefaultAvatarKey = (typeof DEFAULT_AVATAR_KEYS)[number];

const DIRECT_AVATAR_KEY = /^[a-z0-9]$/;

type AvatarUser = Pick<User, 'email' | 'nickname'>;

export function defaultAvatarKeyForUser(user: AvatarUser): DefaultAvatarKey {
  const name = displayName(user).normalize('NFKC').trim();
  const initial = Array.from(name)[0]?.toLowerCase() || '';

  if (DIRECT_AVATAR_KEY.test(initial)) {
    return initial as DefaultAvatarKey;
  }

  return DEFAULT_AVATAR_KEYS[stableHash(name || user.email) % DEFAULT_AVATAR_KEYS.length];
}

export function defaultAvatarURLForUser(user: AvatarUser) {
  return `${DEFAULT_AVATAR_BASE_PATH}/avatar-${defaultAvatarKeyForUser(user)}.png`;
}

function stableHash(value: string) {
  let hash = 0;

  for (const character of Array.from(value)) {
    hash = (hash * 31 + (character.codePointAt(0) || 0)) >>> 0;
  }

  return hash;
}

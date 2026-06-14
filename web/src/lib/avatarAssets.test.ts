import { describe, expect, it } from 'vitest';

import {
  defaultAvatarKeyForIdentity,
  defaultAvatarKeyForUser,
  defaultAvatarURLForIdentity,
  defaultAvatarURLForUser
} from './avatarAssets';

describe('defaultAvatarKeyForIdentity', () => {
  it('uses a single a-z character directly', () => {
    expect(defaultAvatarKeyForIdentity('a')).toBe('a');
  });

  it('lowercases an uppercase letter', () => {
    expect(defaultAvatarKeyForIdentity('Z')).toBe('z');
  });

  it('uses a single digit directly', () => {
    expect(defaultAvatarKeyForIdentity('5')).toBe('5');
  });

  it('maps multi-character identities to a stable key in [0-9a-z]', () => {
    const key = defaultAvatarKeyForIdentity('alice');
    expect(key).toMatch(/^[0-9a-z]$/);
  });

  it('is deterministic for repeated calls', () => {
    expect(defaultAvatarKeyForIdentity('Test')).toBe(defaultAvatarKeyForIdentity('Test'));
  });

  it('normalizes full-width characters via NFKC', () => {
    // Full-width Latin A (U+FF21) normalises to ASCII 'A' → key 'a'
    expect(defaultAvatarKeyForIdentity('Ａ')).toBe('a');
  });

  it('falls back to "?" hash for empty/whitespace input', () => {
    const empty = defaultAvatarKeyForIdentity('');
    const blank = defaultAvatarKeyForIdentity('   ');
    expect(empty).toMatch(/^[0-9a-z]$/);
    expect(blank).toBe(empty);
  });
});

describe('defaultAvatarKeyForUser', () => {
  it('derives the key from the nickname when present', () => {
    const fromNick = defaultAvatarKeyForUser({ email: 'bob@x.com', nickname: 'Alice' });
    const fromIdentity = defaultAvatarKeyForIdentity('Alice');
    expect(fromNick).toBe(fromIdentity);
  });

  it('falls back to the email when nickname is blank', () => {
    // User.nickname 在类型层面是非空 string，但运行时 displayName 会 trim 空白。
    const blankNick = defaultAvatarKeyForUser({ email: 'bob@x.com', nickname: '' });
    expect(blankNick).toBe(defaultAvatarKeyForIdentity('bob@x.com'));

    const whitespaceNick = defaultAvatarKeyForUser({ email: 'bob@x.com', nickname: '  ' });
    expect(whitespaceNick).toBe(defaultAvatarKeyForIdentity('bob@x.com'));
  });
});

describe('avatar URL builders', () => {
  it('builds a deterministic URL containing the key', () => {
    const url = defaultAvatarURLForIdentity('a');
    expect(url).toContain('/avatars/defaults/');
    expect(url).toContain('avatar-a.png');
  });

  it('URLs for user and identity are consistent when nickname is set', () => {
    const user = { email: 'bob@x.com', nickname: 'Alice' };
    expect(defaultAvatarURLForUser(user)).toBe(defaultAvatarURLForIdentity('Alice'));
  });
});

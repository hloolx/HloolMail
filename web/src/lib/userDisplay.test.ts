import { describe, expect, it } from 'vitest';

import {
  MAX_NICKNAME_LENGTH,
  displayInitial,
  displayName,
  displaySubtitle,
  normalizeNicknameInput,
  validateNicknameInput
} from './userDisplay';

const messages = { required: '必填', tooLong: '太长', invalid: '非法' } as const;

describe('normalizeNicknameInput', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeNicknameInput('  bob  ')).toBe('bob');
  });
});

describe('validateNicknameInput', () => {
  it('reports required for empty or whitespace-only input', () => {
    expect(validateNicknameInput('', messages)).toBe('必填');
    expect(validateNicknameInput('   ', messages)).toBe('必填');
  });

  it('accepts a valid nickname', () => {
    expect(validateNicknameInput('ab', messages)).toBe('');
  });

  it('rejects ASCII nicknames longer than MAX_NICKNAME_LENGTH', () => {
    expect(validateNicknameInput('a'.repeat(MAX_NICKNAME_LENGTH), messages)).toBe('');
    expect(validateNicknameInput('a'.repeat(MAX_NICKNAME_LENGTH + 1), messages)).toBe('太长');
  });

  it('counts by code point so 40 emoji fit but 41 do not', () => {
    const emoji = '🎉'.repeat(MAX_NICKNAME_LENGTH);
    expect(validateNicknameInput(emoji, messages)).toBe('');
    expect(validateNicknameInput(emoji + '🎉', messages)).toBe('太长');
  });

  it('rejects C0 control characters (U+0000..U+001F)', () => {
    expect(validateNicknameInput('a\u0001b', messages)).toBe('非法');
  });

  it('rejects DEL and C1 control characters (U+007F..U+009F)', () => {
    expect(validateNicknameInput('a\u007fb', messages)).toBe('非法');
    expect(validateNicknameInput('a\u009Fb', messages)).toBe('非法');
  });

  it('does NOT treat non-breaking space (U+00A0) as a control character', () => {
    expect(validateNicknameInput('a\u00A0b', messages)).toBe('');
  });

  it('accepts plain CJK nicknames', () => {
    expect(validateNicknameInput('张三', messages)).toBe('');
  });
});

describe('displayName / displaySubtitle / displayInitial', () => {
  it('prefers nickname over email', () => {
    const user = { email: 'a@b.com', nickname: 'Bob' };
    expect(displayName(user)).toBe('Bob');
    expect(displaySubtitle(user)).toBe('a@b.com');
    expect(displayInitial(user)).toBe('B');
  });

  it('falls back to email when nickname is null or blank', () => {
    expect(displayName({ email: 'a@b.com', nickname: null })).toBe('a@b.com');
    expect(displaySubtitle({ email: 'a@b.com', nickname: null })).toBe('');
    expect(displayInitial({ email: 'a@b.com', nickname: null })).toBe('A');

    const blank = { email: 'a@b.com', nickname: '  ' };
    expect(displayName(blank)).toBe('a@b.com');
    expect(displaySubtitle(blank)).toBe('');
    expect(displayInitial(blank)).toBe('A');
  });

  it('uppercases the first code point for the initial', () => {
    expect(displayInitial({ email: 'x@y.com', nickname: 'ändrea' })).toBe('Ä');
  });

  it('returns the first emoji as the initial when nickname starts with one', () => {
    expect(displayInitial({ email: 'x@y.com', nickname: '🎉party' })).toBe('🎉');
  });

  it('keeps CJK initial unchanged under toLocaleUpperCase', () => {
    expect(displayInitial({ email: '张@x.com', nickname: '张三' })).toBe('张');
  });
});

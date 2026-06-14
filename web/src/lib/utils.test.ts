import { describe, expect, it } from 'vitest';

import { cn } from './utils';

describe('cn', () => {
  it('joins plain strings', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('skips falsy values', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('skips the number 0 but keeps other numbers', () => {
    expect(cn('a', 0)).toBe('a');
    expect(cn('a', 1)).toBe('a 1');
  });

  it('flattens nested arrays', () => {
    expect(cn('a', ['b', 'c'])).toBe('a b c');
    expect(cn('a', ['b', false, ['c']])).toBe('a b c');
  });

  it('handles objects by keeping truthy keys', () => {
    expect(cn('a', { b: true, c: false })).toBe('a b');
    expect(cn({ a: 1, b: 'x', c: null })).toBe('a b');
  });

  it('returns empty string when given no truthy input', () => {
    expect(cn()).toBe('');
    expect(cn('', false, null)).toBe('');
    expect(cn('a', [])).toBe('a');
  });
});

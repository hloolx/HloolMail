import { describe, expect, it } from 'vitest';

import {
  formatDeliveryError,
  isEmailDeliveryDone,
  isEmailDeliveryFailed,
  isEmailDeliveryInProgress,
  isEmailDeliverySucceeded
} from './emailDelivery';

describe('isEmailDeliveryInProgress', () => {
  it('returns true for in-flight statuses', () => {
    expect(isEmailDeliveryInProgress('pending')).toBe(true);
    expect(isEmailDeliveryInProgress('delivering')).toBe(true);
    expect(isEmailDeliveryInProgress('retry')).toBe(true);
  });

  it('returns false for terminal or unknown statuses', () => {
    expect(isEmailDeliveryInProgress('succeeded')).toBe(false);
    expect(isEmailDeliveryInProgress('failed')).toBe(false);
    expect(isEmailDeliveryInProgress(undefined)).toBe(false);
    expect(isEmailDeliveryInProgress('unknown' as never)).toBe(false);
  });
});

describe('isEmailDeliverySucceeded', () => {
  it('matches only succeeded', () => {
    expect(isEmailDeliverySucceeded('succeeded')).toBe(true);
    expect(isEmailDeliverySucceeded('pending')).toBe(false);
    expect(isEmailDeliverySucceeded(undefined)).toBe(false);
  });
});

describe('isEmailDeliveryFailed', () => {
  it('matches only failed', () => {
    expect(isEmailDeliveryFailed('failed')).toBe(true);
    expect(isEmailDeliveryFailed('succeeded')).toBe(false);
    expect(isEmailDeliveryFailed(undefined)).toBe(false);
  });
});

describe('isEmailDeliveryDone', () => {
  it('is true for succeeded or failed', () => {
    expect(isEmailDeliveryDone('succeeded')).toBe(true);
    expect(isEmailDeliveryDone('failed')).toBe(true);
  });

  it('is false for in-flight or undefined', () => {
    expect(isEmailDeliveryDone('pending')).toBe(false);
    expect(isEmailDeliveryDone('delivering')).toBe(false);
    expect(isEmailDeliveryDone('retry')).toBe(false);
    expect(isEmailDeliveryDone(undefined)).toBe(false);
  });
});

describe('formatDeliveryError', () => {
  it('substitutes the placeholder once', () => {
    expect(formatDeliveryError('错误：{error}', 'timeout')).toBe('错误：timeout');
  });

  it('replaces only the first occurrence (String.replace semantics)', () => {
    // 实现使用 String.replace，只替换首个占位符
    expect(formatDeliveryError('{error} occurred: {error}', 'X')).toBe('X occurred: {error}');
  });

  it('leaves the template unchanged when there is no placeholder', () => {
    expect(formatDeliveryError('无占位符', 'Y')).toBe('无占位符');
  });

  it('substitutes an empty error with an empty string', () => {
    expect(formatDeliveryError('err: {error}', '')).toBe('err: ');
  });

  it('handles an empty template', () => {
    expect(formatDeliveryError('', 'Y')).toBe('');
  });
});

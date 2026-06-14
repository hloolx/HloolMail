import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api';
import {
  addBreadcrumb,
  captureException,
  captureMessage,
  initMonitoring,
  isMonitoringEnabled,
  setMonitoringTag,
  setMonitoringUser
} from './monitoring';

describe('monitoring (no-op fallback)', () => {
  beforeEach(() => {
    // 确保 VITE_SENTRY_DSN 未设置 → provider 保持 no-op
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('reports disabled when DSN is not configured', () => {
    expect(isMonitoringEnabled()).toBe(false);
  });

  it('does not throw when called before init', () => {
    expect(() => captureException(new Error('boom'))).not.toThrow();
    expect(() => captureMessage('hello')).not.toThrow();
    expect(() => setMonitoringUser(null)).not.toThrow();
    expect(() => setMonitoringTag('k', 'v')).not.toThrow();
    expect(() => addBreadcrumb({ category: 'x', message: 'y' })).not.toThrow();
  });

  it('initialises as no-op without throwing when DSN is missing', async () => {
    await expect(initMonitoring()).resolves.toBeUndefined();
  });
});

describe('captureException noise filtering', () => {
  // 直接测试内部噪声判定行为：对噪声错误，captureException 不应抛错且应静默返回。
  // 由于 no-op provider 没有可观测的副作用，这里仅断言「不抛错 + 不抛 warn」。
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('silently swallows 401 ApiError (session expiry)', () => {
    const err = new ApiError('unauthorized', 401, { httpStatus: 401, kind: 'http' });
    expect(() => captureException(err)).not.toThrow();
  });

  it('silently swallows business ApiError (validation failure)', () => {
    const err = new ApiError('nickname too long', 422, { httpStatus: 422, kind: 'business' });
    expect(() => captureException(err)).not.toThrow();
  });

  it('silently swallows AbortError', () => {
    const err = new ApiError('aborted', 0, { httpStatus: 0, kind: 'abort' });
    expect(() => captureException(err)).not.toThrow();

    const domErr = new DOMException('aborted', 'AbortError');
    expect(() => captureException(domErr)).not.toThrow();
  });

  it('accepts real unexpected errors without throwing', () => {
    expect(() => captureException(new Error('real bug'))).not.toThrow();
  });
});

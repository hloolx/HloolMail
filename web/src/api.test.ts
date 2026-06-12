import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api, clearPendingGetRequests } from './api';

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init
  });
}

describe('api', () => {
  beforeEach(() => {
    clearPendingGetRequests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    clearPendingGetRequests();
  });

  it('deduplicates concurrent default GET requests with the same path and headers', async () => {
    let resolveFetch: (response: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn<Window['fetch']>(() => fetchPromise);
    vi.stubGlobal('fetch', fetchMock);

    const first = api<{ ok: boolean }>('/api/inbox');
    const second = api<{ ok: boolean }>('/api/inbox');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch(jsonResponse({ success: true, data: { ok: true } }));

    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
  });

  it('does not deduplicate requests across different API keys', async () => {
    const fetchMock = vi
      .fn<Window['fetch']>()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: 'first' }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: 'second' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api<string>('/api/inbox', { apiKey: 'key-a' })).resolves.toBe('first');
    await expect(api<string>('/api/inbox', { apiKey: 'key-b' })).resolves.toBe('second');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('X-API-Key')).toBe('key-a');
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('X-API-Key')).toBe('key-b');
  });

  it('retries transient network failures and returns the later successful response', async () => {
    const fetchMock = vi
      .fn<Window['fetch']>()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { recovered: true } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api<{ recovered: boolean }>('/api/retry', { retries: 1, retryDelay: 1 })).resolves.toEqual({ recovered: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('converts request timeouts into ApiError with timeout kind', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<Window['fetch']>((_input, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason));
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const request = api('/api/slow', { timeout: 50 });
    const expectation = expect(request).rejects.toMatchObject({
      name: 'ApiError',
      status: 408,
      kind: 'timeout'
    } satisfies Partial<ApiError>);
    await vi.advanceTimersByTimeAsync(50);
    await expectation;
  });
});

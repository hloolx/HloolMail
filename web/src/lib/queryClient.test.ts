import { QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, clearPendingGetRequests } from '../api';
import type { MeResponse } from '../types';
import { createAppQueryClient } from './queryClient';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn()
  }
}));

describe('createAppQueryClient', () => {
  afterEach(() => {
    clearPendingGetRequests();
    vi.restoreAllMocks();
  });

  it('stabilizes anonymous auth probes after a 401 response', async () => {
    const queryClient = createAppQueryClient();
    let calls = 0;
    const options = () => ({
      queryKey: ['me'] as const,
      queryFn: async () => {
        calls += 1;
        throw new ApiError('login required', 401);
      },
      retry: false
    });
    const observer = new QueryObserver<MeResponse, Error, MeResponse, MeResponse, readonly ['me']>(queryClient, options());
    const unsubscribe = observer.subscribe(() => {});

    await observer.refetch();
    await Promise.resolve();

    expect(calls).toBe(1);
    expect(queryClient.getQueryData(['me'])).toEqual({ installed: true, user: null });

    for (let index = 0; index < 5; index += 1) {
      observer.setOptions(options());
      await Promise.resolve();
    }

    expect(calls).toBe(1);
    unsubscribe();
    queryClient.clear();
  });
});

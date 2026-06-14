import { describe, expect, it } from 'vitest';

import { ApiError } from '../api';
import { unwrapApiEnvelope } from './openapiClient';

describe('openapiClient helpers', () => {
  it('unwraps successful API envelopes', () => {
    const result = unwrapApiEnvelope({
      success: true,
      error: null,
      data: { domains: ['example.com'] }
    });

    expect(result.domains).toEqual(['example.com']);
  });

  it('throws ApiError for business envelopes', () => {
    expect(() =>
      unwrapApiEnvelope({
        success: false,
        error: 'domain is unavailable',
        data: null
      })
    ).toThrow(ApiError);
  });
});

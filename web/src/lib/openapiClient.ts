import createClient from 'openapi-fetch';

import { ApiError } from '../api';
import type { components, paths } from '../types/generated';

export type ApiPath = keyof paths;
export type ApiSchema<Name extends keyof components['schemas']> = components['schemas'][Name];

type EnvelopeShape<TData> = {
  success: boolean;
  data: TData;
  error: string | null;
};

export type EnvelopeData<TEnvelope> = TEnvelope extends EnvelopeShape<infer TData> ? TData : never;

export const openapiClient = createClient<paths>({
  baseUrl: ''
});

type OpenApiResult<TEnvelope extends EnvelopeShape<unknown>> = {
  data?: TEnvelope;
  error?: unknown;
  response: Response;
};

function buildOpenApiHeaders(apiKey?: string): HeadersInit | undefined {
  if (!apiKey) return undefined;
  return { 'X-API-Key': apiKey };
}

function unwrapOpenApiResult<TEnvelope extends EnvelopeShape<unknown>>(
  result: OpenApiResult<TEnvelope>
): EnvelopeData<TEnvelope> {
  if (result.error || !result.data) {
    throwOpenApiError(result.error, result.response);
  }
  return unwrapApiEnvelope(result.data);
}

export async function getAvailableDomains(options: { apiKey?: string } = {}) {
  return unwrapOpenApiResult<ApiSchema<'EnvelopeAvailableDomains'>>(
    await openapiClient.GET('/api/domains/available', {
      headers: buildOpenApiHeaders(options.apiKey)
    })
  );
}

export async function getStats() {
  return unwrapOpenApiResult<ApiSchema<'EnvelopeStats'>>(
    await openapiClient.GET('/api/stats')
  );
}

export async function getVersionInfo() {
  return unwrapOpenApiResult<ApiSchema<'EnvelopeVersion'>>(
    await openapiClient.GET('/api/version')
  );
}

export function unwrapApiEnvelope<TEnvelope extends EnvelopeShape<unknown>>(
  envelope: TEnvelope
): EnvelopeData<TEnvelope> {
  if (!envelope.success) {
    throw new ApiError(String(envelope.error || 'Request failed'), 422, {
      httpStatus: 200,
      kind: 'business',
      error: envelope.error
    });
  }
  return envelope.data as EnvelopeData<TEnvelope>;
}

export function throwOpenApiError(error: unknown, response?: Response): never {
  const message = readOpenApiErrorMessage(error, response);
  throw new ApiError(message, response?.status ?? 0, {
    httpStatus: response?.status ?? 0,
    kind: response ? 'http' : 'parse',
    error
  });
}

function readOpenApiErrorMessage(error: unknown, response?: Response): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && 'error' in error) {
    const value = (error as { error?: unknown }).error;
    if (typeof value === 'string' && value.trim()) return value;
  }
  return response?.statusText || `HTTP ${response?.status ?? 0}`;
}

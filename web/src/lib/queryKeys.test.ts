import { describe, expect, it } from 'vitest';

import { queryKeys } from './queryKeys';

describe('queryKeys factories', () => {
  it('produces stable root keys', () => {
    expect(queryKeys.me).toEqual(['me']);
    expect(queryKeys.installStatus).toEqual(['install-status']);
  });

  it('nests domain/apiKeys namespaces', () => {
    expect(queryKeys.domains.all).toEqual(['domains-all']);
    expect(queryKeys.apiKeys.all).toEqual(['api-keys']);
  });

  it('builds parameterised cache keys deterministically', () => {
    expect(queryKeys.loginSettingsEmailDelivery(123)).toEqual(['login-settings', 'email-delivery', 123]);
    expect(queryKeys.admin.timeseries('7d')).toEqual(['admin-stats-timeseries', '7d']);
    expect(queryKeys.webhooks.list(1, 20)).toEqual(['webhooks', 1, 20]);
    expect(queryKeys.webhooks.deliveries(7, 2)).toEqual(['webhook-deliveries', 7, 2]);
  });

  it('passes null/undefined delivery ids through verbatim', () => {
    expect(queryKeys.loginSettingsEmailDelivery(null)).toEqual(['login-settings', 'email-delivery', null]);
    expect(queryKeys.admin.loginSettingsEmailDelivery(null)).toEqual([
      'admin-login-settings',
      'email-delivery',
      null
    ]);
  });

  it('encodes filters inside admin cache keys', () => {
    const filters = { severity: 'critical' };
    expect(queryKeys.admin.auditLogs(filters, 'search', 1, 20)).toEqual([
      'admin-audit-logs',
      filters,
      'search',
      1,
      20
    ]);
  });

  it('produces separate root keys for list endpoints', () => {
    expect(queryKeys.admin.domainCheckRunsRoot).toEqual(['admin-domain-check-runs']);
    expect(queryKeys.webhooks.deliveriesRoot(5)).toEqual(['webhook-deliveries', 5]);
  });
});

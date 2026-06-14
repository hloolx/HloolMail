import { describe, expect, it } from 'vitest';

import { domainInputWantsWildcard, normalizeDomainInput } from './domain';

describe('normalizeDomainInput', () => {
  it('trims and lowercases the input', () => {
    expect(normalizeDomainInput('  Example.COM  ')).toBe('example.com');
  });

  it('strips the "*." wildcard prefix', () => {
    expect(normalizeDomainInput('*.example.com')).toBe('example.com');
  });

  it('strips a lone leading asterisk', () => {
    expect(normalizeDomainInput('*example.com')).toBe('example.com');
  });

  it('returns empty for wildcard-only input', () => {
    expect(normalizeDomainInput('*')).toBe('');
    expect(normalizeDomainInput('*.')).toBe('');
  });

  it('strips leading and trailing dots', () => {
    expect(normalizeDomainInput('...example.com...')).toBe('example.com');
    expect(normalizeDomainInput('.example.com')).toBe('example.com');
    expect(normalizeDomainInput('example.com.')).toBe('example.com');
  });

  it('combines whitespace, wildcard and uppercase', () => {
    expect(normalizeDomainInput('  *.EXAMPLE.COM  ')).toBe('example.com');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeDomainInput('')).toBe('');
  });

  it('preserves normal subdomains', () => {
    expect(normalizeDomainInput('a.b.c')).toBe('a.b.c');
  });
});

describe('domainInputWantsWildcard', () => {
  it('detects typical wildcard input', () => {
    expect(domainInputWantsWildcard('*.example.com')).toBe(true);
  });

  it('detects lone asterisk', () => {
    expect(domainInputWantsWildcard('*')).toBe(true);
  });

  it('trims leading whitespace before checking', () => {
    expect(domainInputWantsWildcard('  *.x')).toBe(true);
  });

  it('returns false for plain domain', () => {
    expect(domainInputWantsWildcard('example.com')).toBe(false);
  });

  it('returns false when asterisk is not at the start', () => {
    expect(domainInputWantsWildcard('x*')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(domainInputWantsWildcard('')).toBe(false);
  });
});

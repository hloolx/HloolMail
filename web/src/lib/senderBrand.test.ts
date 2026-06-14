import { describe, expect, it } from 'vitest';

import {
  extractSenderDomain,
  getRegistrableDomain,
  getSenderBrandIdentity,
  senderDisplayName,
  senderDomain,
  senderIdentityKey,
  senderInitial
} from './senderBrand';

describe('extractSenderDomain', () => {
  it('returns empty for empty / nullish input', () => {
    expect(extractSenderDomain('')).toBe('');
    expect(extractSenderDomain(undefined)).toBe('');
    expect(extractSenderDomain(null)).toBe('');
  });

  it('extracts the host from a plain email', () => {
    expect(extractSenderDomain('user@example.com')).toBe('example.com');
  });

  it('extracts the host from an angle-bracketed email', () => {
    expect(extractSenderDomain('Name <user@example.com>')).toBe('example.com');
    expect(extractSenderDomain('<user@example.com>')).toBe('example.com');
  });

  it('lowercases the host', () => {
    expect(extractSenderDomain('USER@EXAMPLE.COM')).toBe('example.com');
  });

  it('extracts the host from http(s) URLs', () => {
    expect(extractSenderDomain('https://mail.example.com/path')).toBe('mail.example.com');
    expect(extractSenderDomain('http://example.com')).toBe('example.com');
  });

  it('extracts a bare domain', () => {
    expect(extractSenderDomain('example.com')).toBe('example.com');
  });

  it('strips a leading www', () => {
    expect(extractSenderDomain('www.example.com')).toBe('example.com');
  });

  it('returns empty for text without any domain-like token', () => {
    expect(extractSenderDomain('random text')).toBe('');
  });

  it('keeps subdomains in the host (does NOT reduce to registrable)', () => {
    expect(extractSenderDomain('user@sub.example.com')).toBe('sub.example.com');
  });
});

describe('getRegistrableDomain', () => {
  it('returns the input as-is for two-label domains', () => {
    expect(getRegistrableDomain('example.com')).toBe('example.com');
  });

  it('reduces a single-label subdomain to the registrable domain', () => {
    expect(getRegistrableDomain('sub.example.com')).toBe('example.com');
    expect(getRegistrableDomain('a.b.example.com')).toBe('example.com');
  });

  it('handles multi-part suffixes (e.g. .com.cn)', () => {
    expect(getRegistrableDomain('example.com.cn')).toBe('example.com.cn');
    expect(getRegistrableDomain('sub.example.com.cn')).toBe('example.com.cn');
  });

  it('recognises the .co.uk suffix', () => {
    expect(getRegistrableDomain('example.co.uk')).toBe('example.co.uk');
  });

  it('prefers the longest known brand domain match', () => {
    expect(getRegistrableDomain('work.weixin.qq.com')).toBe('work.weixin.qq.com');
    expect(getRegistrableDomain('api.github.com')).toBe('github.com');
  });

  it('returns empty for empty input', () => {
    expect(getRegistrableDomain('')).toBe('');
  });

  it('keeps a single label without dots', () => {
    expect(getRegistrableDomain('singleword')).toBe('singleword');
  });
});

describe('getSenderBrandIdentity', () => {
  it('marks known brand domains as known and uses the brand display name', () => {
    const id = getSenderBrandIdentity({ fromAddress: 'noreply@github.com' });
    expect(id.domain).toBe('github.com');
    expect(id.senderDomain).toBe('github.com');
    expect(id.displayName).toBe('GitHub');
    expect(id.known).toBe(true);
  });

  it('humanizes unknown domains', () => {
    const id = getSenderBrandIdentity({ fromAddress: 'x@random.xyz' });
    expect(id.domain).toBe('random.xyz');
    expect(id.known).toBe(false);
    expect(id.displayName).toBe('Random');
  });

  it('falls back to fromName when there is no domain', () => {
    const id = getSenderBrandIdentity({ fromName: 'Bob', fromAddress: '' });
    expect(id.domain).toBe('');
    expect(id.displayName).toBe('Bob');
  });

  it('falls back to "unknown" when neither name nor address is present', () => {
    const id = getSenderBrandIdentity({});
    expect(id.displayName).toBe('unknown');
    expect(id.known).toBe(false);
  });
});

describe('senderDisplayName / senderInitial / senderIdentityKey', () => {
  it('prefers fromName', () => {
    expect(senderDisplayName({ fromName: 'Bob' })).toBe('Bob');
  });

  it('falls back to the email address when name is blank', () => {
    expect(senderDisplayName({ fromName: '   ', fromAddress: 'a@b.com' })).toBe('a@b.com');
  });

  it('returns unknown when nothing is provided', () => {
    expect(senderDisplayName({})).toBe('unknown');
  });

  it('computes ASCII initials in uppercase', () => {
    expect(senderInitial({ fromName: 'alice' })).toBe('A');
  });

  it('falls back to the first code point for non-ASCII names', () => {
    expect(senderInitial({ fromName: '张三' })).toBe('张');
    expect(senderInitial({ fromName: '🎉' })).toBe('🎉');
  });

  it('returns "U" (from "unknown") when nothing is available', () => {
    // senderDisplayName({}) 返回 'unknown'，initial 取首字母 'U'
    expect(senderInitial({})).toBe('U');
  });

  it('builds a stable identity key', () => {
    expect(senderIdentityKey({ fromName: 'Bob', fromAddress: 'b@x.com' })).toBe('Bob x.com');
    expect(senderIdentityKey({ fromAddress: 'b@x.com' })).toBe('b@x.com x.com');
  });
});

describe('senderDomain (alias of extractSenderDomain)', () => {
  it('behaves identically to extractSenderDomain', () => {
    expect(senderDomain('a@b.com')).toBe(extractSenderDomain('a@b.com'));
  });
});

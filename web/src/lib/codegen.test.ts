import { describe, expect, it } from 'vitest';

import { codeGenLabel, generateCode, type CodeGenRequest } from './codegen';

const baseRequest: CodeGenRequest = {
  method: 'post',
  url: 'https://x.com',
  headers: { A: 'b' },
  body: '{"k":"v"}'
};

describe('codeGenLabel', () => {
  it('returns friendly labels for supported languages', () => {
    expect(codeGenLabel('curl')).toBe('cURL');
    expect(codeGenLabel('fetch')).toBe('fetch (JS)');
    expect(codeGenLabel('python')).toBe('Python');
  });

  it('returns the raw value for unknown languages', () => {
    expect(codeGenLabel('rust' as never)).toBe('rust');
  });
});

describe('generateCode - curl', () => {
  it('renders method, headers, body and url', () => {
    const out = generateCode(baseRequest, 'curl');
    expect(out).toContain('curl -X POST');
    expect(out).toContain("-H 'A: b'");
    expect(out).toContain("--data '{\"k\":\"v\"}'");
    expect(out).toContain('"https://x.com"');
  });

  it('uppercases the method', () => {
    expect(generateCode({ ...baseRequest, method: 'get', body: undefined, headers: {} }, 'curl')).toContain('-X GET');
  });

  it('shell-escapes single quotes in header values', () => {
    const out = generateCode({ ...baseRequest, headers: { Authorization: "a'b" } }, 'curl');
    expect(out).toContain("-H 'Authorization: a'\\''b'");
  });

  it('shell-escapes single quotes in the body', () => {
    const out = generateCode({ ...baseRequest, body: "it's" }, 'curl');
    expect(out).toContain("--data 'it'\\''s'");
  });

  it('omits the --data flag when there is no body', () => {
    const out = generateCode({ ...baseRequest, body: undefined }, 'curl');
    expect(out).not.toContain('--data');
  });

  it('omits headers when none are provided', () => {
    const out = generateCode({ ...baseRequest, headers: {}, body: undefined }, 'curl');
    expect(out).not.toContain('-H');
  });
});

describe('generateCode - fetch', () => {
  it('always emits method, and emits headers/body only when present', () => {
    expect(generateCode({ method: 'get', url: 'https://x.com', headers: {} }, 'fetch')).toBe(
      'fetch("https://x.com", {\n  "method": "GET"\n});'
    );

    const withAll = generateCode(baseRequest, 'fetch');
    expect(withAll).toContain('"method": "POST"');
    expect(withAll).toContain('"headers"');
    expect(withAll).toContain('"body"');
  });
});

describe('generateCode - python', () => {
  it('emits requests.request with json= for valid JSON object body', () => {
    const out = generateCode(baseRequest, 'python');
    expect(out).toContain('requests.request("POST", "https://x.com"');
    expect(out).toContain('headers={"A":"b"}');
    expect(out).toContain('json=');
    expect(out).toContain('k: "v"');
  });

  it('falls back to data= for invalid JSON body', () => {
    const out = generateCode({ ...baseRequest, body: 'plain' }, 'python');
    expect(out).toContain('data="plain"');
  });

  it('renders arrays with proper indentation', () => {
    const out = generateCode({ ...baseRequest, body: '[1,2]' }, 'python');
    expect(out).toContain('json=[');
    expect(out).toMatch(/1,\s*\n/);
    expect(out).toMatch(/2/);
  });

  it('converts JSON booleans/null to Python True/False/None', () => {
    const out = generateCode({ ...baseRequest, body: '{"a":true,"b":false,"c":null}' }, 'python');
    expect(out).toContain('a: True');
    expect(out).toContain('b: False');
    expect(out).toContain('c: None');
  });

  it('quotes object keys that are not valid Python identifiers', () => {
    const out = generateCode({ ...baseRequest, body: '{"a-b": 1}' }, 'python');
    expect(out).toContain('"a-b": 1');
  });

  it('does not quote valid identifier keys', () => {
    const out = generateCode({ ...baseRequest, body: '{"abc": 1}' }, 'python');
    expect(out).toContain('abc: 1');
  });

  it('renders empty collections compactly', () => {
    expect(generateCode({ ...baseRequest, body: '{}' }, 'python')).toContain('json={}');
    expect(generateCode({ ...baseRequest, body: '[]' }, 'python')).toContain('json=[]');
  });

  it('omits json=/data= when there is no body', () => {
    const out = generateCode({ ...baseRequest, body: undefined, headers: {} }, 'python');
    expect(out).not.toContain('json=');
    expect(out).not.toContain('data=');
  });
});

describe('generateCode - unknown language', () => {
  it('returns an empty string', () => {
    expect(generateCode(baseRequest, 'rust' as never)).toBe('');
  });
});

import { describe, expect, it } from 'vitest';

import { buildEmailSrcDoc } from './emailHtml';

function parseSrcDoc(html: string) {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('buildEmailSrcDoc', () => {
  it('wraps email content in a locked-down iframe document', () => {
    const doc = parseSrcDoc(buildEmailSrcDoc('<p>Hello</p>'));
    const csp = doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') || '';

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(doc.querySelector('base')?.getAttribute('target')).toBe('_blank');
    expect(doc.querySelector('.email-root')?.innerHTML).toContain('<p>Hello</p>');
  });

  it('removes executable elements and event handlers from email HTML', () => {
    const doc = parseSrcDoc(
      buildEmailSrcDoc(`
        <script>alert(1)</script>
        <iframe srcdoc="<p>evil</p>"></iframe>
        <form action="/steal"><input name="token" /></form>
        <p onclick="alert(1)">Safe text</p>
        <meta http-equiv="refresh" content="0;url=https://evil.example" />
      `)
    );

    expect(doc.querySelector('script, iframe, form, input, meta[http-equiv="refresh"]')).toBeNull();
    expect(doc.querySelector('p')?.getAttribute('onclick')).toBeNull();
    expect(doc.querySelector('p')?.textContent).toBe('Safe text');
  });

  it('keeps safe links and resources while blocking dangerous URLs', () => {
    const doc = parseSrcDoc(
      buildEmailSrcDoc(`
        <a id="safe" href="https://example.com">safe</a>
        <a id="bad" href="javascript:alert(1)">bad</a>
        <img id="inline" src="data:image/png;base64,AAAA" />
        <img id="remote" src="https://evil.example/pixel.png" srcset="https://evil.example/2x.png 2x" />
      `)
    );

    expect(doc.querySelector<HTMLAnchorElement>('#safe')?.getAttribute('href')).toBe('https://example.com');
    expect(doc.querySelector('#safe')?.getAttribute('target')).toBe('_blank');
    expect(doc.querySelector('#safe')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(doc.querySelector('#bad')?.hasAttribute('href')).toBe(false);
    expect(doc.querySelector('#inline')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(doc.querySelector('#remote')?.hasAttribute('src')).toBe(false);
    expect(doc.querySelector('#remote')?.getAttribute('data-blocked-src')).toBe('https://evil.example/pixel.png');
    expect(doc.querySelector('#remote')?.hasAttribute('srcset')).toBe(false);
  });

  it('strips imported and remote CSS from inline styles', () => {
    const doc = parseSrcDoc(
      buildEmailSrcDoc(`<p style="@import url('https://evil.example/a.css'); background: url(https://evil.example/a.png); color: red">Text</p>`)
    );

    const style = doc.querySelector('p')?.getAttribute('style') || '';
    expect(style).not.toContain('@import');
    expect(style).not.toContain('https://evil.example');
    expect(style).toContain('color: red');
  });
});

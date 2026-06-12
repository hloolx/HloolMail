import { describe, expect, it } from 'vitest';

import { markdownToText, simpleMarkdownToHTML } from './markdown';

function parseHTML(html: string) {
  return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
}

describe('simpleMarkdownToHTML', () => {
  it('escapes raw HTML before rendering generated markdown tags', () => {
    const doc = parseHTML(simpleMarkdownToHTML(`# Hello\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>`));

    expect(doc.querySelector('h1')?.textContent).toBe('Hello');
    expect(doc.querySelector('script')).toBeNull();
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.body.textContent).toContain('<script>alert(1)</script>');
    expect(doc.body.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('allows safe links and removes unsafe link protocols', () => {
    const doc = parseHTML(simpleMarkdownToHTML('[safe](https://example.com) [bad](javascript:alert(1)) [relative](/inbox)'));
    const links = Array.from(doc.querySelectorAll('a'));

    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('https://example.com');
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[1].getAttribute('href')).toBe('/inbox');
    expect(doc.body.textContent).toContain('bad');
    expect(doc.body.innerHTML).not.toContain('javascript:');
  });

  it('allows only http and https image sources', () => {
    const doc = parseHTML(simpleMarkdownToHTML('![safe](https://example.com/a.png) ![bad](data:image/png;base64,AAAA)'));
    const images = Array.from(doc.querySelectorAll('img'));

    expect(images).toHaveLength(1);
    expect(images[0].getAttribute('src')).toBe('https://example.com/a.png');
    expect(images[0].getAttribute('alt')).toBe('safe');
    expect(doc.body.textContent).toContain('bad');
  });

  it('escapes code blocks and sanitizes language classes', () => {
    const doc = parseHTML(simpleMarkdownToHTML('```ts onclick=alert(1)\n<div onclick="alert(1)">x</div>\n```'));
    const code = doc.querySelector('pre code');

    expect(code?.getAttribute('class')).toBe('language-ts-onclick-alert-1');
    expect(code?.innerHTML).toContain('&lt;div onclick="alert(1)"&gt;x&lt;/div&gt;');
    expect(doc.querySelector('div')).toBeNull();
  });
});

describe('markdownToText', () => {
  it('removes markdown syntax for safe previews', () => {
    expect(markdownToText('# Title\n\nHello **world** [link](https://example.com) `secret`')).toBe('Title Hello world link');
  });
});

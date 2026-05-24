/**
 * Strips markdown formatting and returns plain text.
 * Used for content previews (first ~100 chars).
 */
export function markdownToText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^---+/gm, '')
    .replace(/\n{2,}/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Converts a subset of markdown to HTML.
 * Handles: headings, bold, italic, inline code, links, blockquotes,
 * ordered/unordered lists, horizontal rules, paragraphs.
 */
export function simpleMarkdownToHTML(markdown: string): string {
  const tokens: string[] = [];
  const tokenFor = (html: string) => `%%MDTOKEN${tokens.push(html) - 1}%%`;

  let html = markdown.replace(/\r\n?/g, '\n');

  html = html.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_match, rawLang: string, code: string) => {
    const lang = sanitizeCodeLanguage(rawLang);
    const classAttr = lang ? ` class="${escapeAttribute(`language-${lang}`)}"` : '';
    return tokenFor(`<pre><code${classAttr}>${escapeHtml(code)}</code></pre>`);
  });

  html = html.replace(/(?<!`)`([^`\n]+)`(?!`)/g, (_match, code: string) => tokenFor(`<code>${escapeHtml(code)}</code>`));

  html = escapeHtml(html);

  html = html.replace(/!\[([^\]]*?)\]\(([^)]+?)\)/g, (_match, alt: string, rawSrc: string) => {
    const src = sanitizeMarkdownUrl(rawSrc, 'image');
    if (!src) return alt;
    return `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}" />`;
  });

  html = html.replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, (_match, label: string, rawHref: string) => {
    const href = sanitizeMarkdownUrl(rawHref, 'link');
    if (!href) return label;
    return `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  html = html.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/(?<!_)_([^_\n]+?)_(?!_)/g, '<em>$1</em>');

  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  html = html.replace(/^[-*_]{3,}\s*$/gm, '<hr />');

  html = html.replace(/^&gt;\s?(.*(?:\n&gt;\s?.*)*)$/gm, (_match, quote: string) => {
    const lines = quote.split('\n').map((line: string) => line.replace(/^&gt;\s?/, ''));
    return `<blockquote>${lines.join('<br />')}</blockquote>`;
  });

  html = convertMarkdownTables(html);

  html = html.replace(/((?:^[-*+]\s+.+$\n?)+)/gm, (_match, list: string) => renderMarkdownList(list, false));
  html = html.replace(/((?:^\d+\.\s+.+$\n?)+)/gm, (_match, list: string) => renderMarkdownList(list, true));

  const lines = html.split('\n');
  const result: string[] = [];
  const blockTags = /^<\s*(\/)?(h[1-6]|ul|ol|li|pre|blockquote|hr|div|p|table|thead|tbody|tr|th|td|img|code)\b/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      result.push('');
      continue;
    }
    if (/^%%MDTOKEN\d+%%$/.test(line)) {
      result.push(line);
      continue;
    }
    if (blockTags.test(line)) {
      result.push(line);
      continue;
    }
    result.push(`<p>${line}</p>`);
  }

  html = restoreMarkdownTokens(result.join('\n').replace(/<p>\s*<\/p>/g, ''), tokens);

  return sanitizeMarkdownHTML(html);
}

function renderMarkdownList(list: string, ordered: boolean) {
  const items = list
    .split('\n')
    .filter((line) => (ordered ? /^\d+\.\s/.test(line) : /^[-*+]\s/.test(line)))
    .map((line) => `<li>${line.replace(ordered ? /^\d+\.\s+/ : /^[-*+]\s+/, '')}</li>`)
    .join('');

  return ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
}

function convertMarkdownTables(markdown: string) {
  const lines = markdown.split('\n');
  const result: string[] = [];

  for (let index = 0; index < lines.length; ) {
    const headerLine = lines[index];
    const separatorLine = lines[index + 1];

    if (headerLine && separatorLine && isMarkdownTableRow(headerLine) && isMarkdownTableSeparator(separatorLine)) {
      const headers = splitMarkdownTableRow(headerLine);
      const rows: string[][] = [];
      index += 2;

      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        rows.push(splitMarkdownTableRow(lines[index]));
        index += 1;
      }

      result.push(renderMarkdownTable(headers, rows));
      continue;
    }

    result.push(headerLine);
    index += 1;
  }

  return result.join('\n');
}

function renderMarkdownTable(headers: string[], rows: string[][]) {
  const headerCells = headers.map((cell) => `<th>${cell.trim()}</th>`).join('');
  const bodyRows = rows.map((row) => `<tr>${row.map((cell) => `<td>${cell.trim()}</td>`).join('')}</tr>`).join('');

  return `<table><thead><tr>${headerCells}</tr></thead>${bodyRows ? `<tbody>${bodyRows}</tbody>` : ''}</table>`;
}

function isMarkdownTableRow(line: string) {
  return line.includes('|') && !line.trim().startsWith('<');
}

function isMarkdownTableSeparator(line: string) {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim().replace(/\s+/g, '')));
}

function splitMarkdownTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function restoreMarkdownTokens(html: string, tokens: string[]) {
  let output = html;
  tokens.forEach((token, index) => {
    output = output.replaceAll(`%%MDTOKEN${index}%%`, token);
  });
  return output;
}

function sanitizeMarkdownHTML(html: string) {
  if (typeof DOMParser === 'undefined') return html;

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const allowedTags = new Set([
    'a',
    'blockquote',
    'br',
    'code',
    'div',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'img',
    'li',
    'ol',
    'p',
    'pre',
    'span',
    'strong',
    'table',
    'tbody',
    'td',
    'th',
    'thead',
    'tr',
    'ul'
  ]);

  doc.body.querySelectorAll('*').forEach((element) => {
    const tagName = element.tagName.toLowerCase();
    if (!allowedTags.has(tagName)) {
      element.remove();
      return;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;

      if (name.startsWith('on') || name === 'style' || name === 'srcset' || name === 'formaction') {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (tagName === 'a') {
        if (name === 'href') {
          if (isSafeMarkdownHref(value)) {
            element.setAttribute('target', '_blank');
            element.setAttribute('rel', 'noopener noreferrer');
          } else {
            element.removeAttribute(attribute.name);
          }
          continue;
        }
        if (name !== 'target' && name !== 'rel' && name !== 'title') {
          element.removeAttribute(attribute.name);
        }
        continue;
      }

      if (tagName === 'img') {
        if (name === 'src') {
          if (!isSafeMarkdownImageSrc(value)) {
            element.removeAttribute(attribute.name);
          }
          continue;
        }
        if (name !== 'alt' && name !== 'title' && name !== 'width' && name !== 'height' && name !== 'loading' && name !== 'decoding') {
          element.removeAttribute(attribute.name);
        }
        continue;
      }

      if (tagName === 'code' && name === 'class') continue;
      if (tagName === 'th' || tagName === 'td') {
        if (name !== 'colspan' && name !== 'rowspan' && name !== 'align') {
          element.removeAttribute(attribute.name);
        }
        continue;
      }

      element.removeAttribute(attribute.name);
    }
  });

  return doc.body.innerHTML;
}

function isSafeMarkdownHref(value: string) {
  const url = decodeHtmlEntities(value.trim());
  if (!url) return false;
  if (url.startsWith('#') || url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return true;

  const scheme = url.match(/^([a-zA-Z][a-zA-Z\d+.-]*):/);
  if (!scheme) return false;
  return ['http', 'https', 'mailto', 'tel'].includes(scheme[1].toLowerCase());
}

function isSafeMarkdownImageSrc(value: string) {
  const url = decodeHtmlEntities(value.trim());
  if (!url) return false;
  if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return true;

  const scheme = url.match(/^([a-zA-Z][a-zA-Z\d+.-]*):/);
  if (!scheme) return false;
  return ['http', 'https'].includes(scheme[1].toLowerCase());
}

function sanitizeMarkdownUrl(rawUrl: string, kind: 'link' | 'image') {
  const url = decodeHtmlEntities(rawUrl.trim().replace(/^<|>$/g, ''));
  if (!url) return '';

  const scheme = url.match(/^([a-zA-Z][a-zA-Z\d+.-]*):/);
  if (scheme) {
    const protocol = scheme[1].toLowerCase();
    if (kind === 'link' && ['http', 'https', 'mailto', 'tel'].includes(protocol)) return url;
    if (kind === 'image' && ['http', 'https'].includes(protocol)) return url;
    return '';
  }

  return url;
}

function sanitizeCodeLanguage(value: string) {
  const cleaned = value.trim().toLowerCase().match(/[a-z0-9_-]+/g)?.join('-') || '';
  return cleaned;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value: string) {
  return escapeHtml(value);
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#96;/g, '`');
}

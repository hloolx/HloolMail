const EMAIL_FRAME_CSS = `
  :root {
    color-scheme: light;
  }

  * {
    box-sizing: border-box;
  }

  html,
  body {
    min-height: 100%;
    margin: 0;
    background: #f4f6f8;
    color: #1f2937;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }

  body {
    padding: 16px;
  }

  .email-root {
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
    background: #ffffff;
  }

  table {
    max-width: 100%;
  }

  .email-root > table {
    margin-right: auto;
    margin-left: auto;
  }

  img {
    max-width: 100%;
    height: auto;
  }

  a {
    color: #2563eb;
  }

  @media (max-width: 640px) {
    body {
      padding: 10px;
    }

    .email-root {
      max-width: 100%;
    }
  }
`;

export function buildEmailSrcDoc(html: string): string {
  const sanitizedHtml = sanitizeEmailHtml(html);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: cid:; media-src data: blob: cid:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'" />
    <base target="_blank" />
    <style>${EMAIL_FRAME_CSS}</style>
  </head>
  <body>
    <main class="email-root">${sanitizedHtml}</main>
  </body>
</html>`;
}

function sanitizeEmailHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return escapeHtml(html);

  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, form, input, button, textarea, select, meta[http-equiv="refresh"]').forEach((node) => {
    node.remove();
  });
  doc.querySelectorAll('link').forEach((node) => {
    const rel = node.getAttribute('rel')?.toLowerCase() || '';
    if (rel.includes('stylesheet') || rel.includes('preload') || rel.includes('prefetch') || rel.includes('preconnect')) {
      node.remove();
    }
  });

  doc.querySelectorAll<HTMLElement>('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;

      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if (name === 'style') {
        element.setAttribute(attribute.name, sanitizeInlineStyle(value));
        continue;
      }

      if (name === 'href') {
        sanitizeHref(element, value);
        continue;
      }

      if (name === 'src' || name === 'poster') {
        sanitizeEmbeddedResource(element, attribute.name, value);
        continue;
      }

      if (name === 'srcset') {
        element.removeAttribute(attribute.name);
      }
    }
  });

  return doc.body.innerHTML;
}

function sanitizeHref(element: HTMLElement, value: string) {
  if (!isSafeHref(value)) {
    element.removeAttribute('href');
    return;
  }
  element.setAttribute('target', '_blank');
  element.setAttribute('rel', 'noopener noreferrer');
}

function sanitizeEmbeddedResource(element: HTMLElement, attributeName: string, value: string) {
  if (isAllowedEmbeddedResource(value)) return;
  element.setAttribute(`data-blocked-${attributeName}`, value);
  element.removeAttribute(attributeName);
}

function isSafeHref(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return true;

  try {
    const url = new URL(trimmed, window.location.origin);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function isAllowedEmbeddedResource(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return true;

  try {
    const url = new URL(trimmed, window.location.origin);
    return ['data:', 'blob:', 'cid:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function sanitizeInlineStyle(value: string) {
  return value
    .replace(/@import\s+[^;]+;?/gi, '')
    .replace(/url\(\s*(['"]?)(https?:|\/\/)[^)]+\1\s*\)/gi, 'none');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

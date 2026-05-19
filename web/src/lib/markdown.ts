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
  let html = markdown
    // Escape HTML entities
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Fenced code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre><code class="language-${lang || ''}">${escaped}</code></pre>`;
  });

  // Inline code (after fenced blocks to avoid double-processing)
  html = html.replace(/(?<!`)`([^`]+)`(?!`)/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_\n]+?)_/g, '<em>$1</em>');

  // Images
  html = html.replace(/!\[([^\]]*?)\]\(([^)]+?)\)/g, '<img src="$2" alt="$1" />');

  // Links
  html = html.replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Headings
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // Horizontal rules
  html = html.replace(/^[-*_]{3,}\s*$/gm, '<hr />');

  // Blockquotes
  html = html.replace(/^&gt;\s?(.*)/gm, '<blockquote>$1</blockquote>');
  // Merge consecutive blockquotes
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

  // Unordered lists
  html = html.replace(/((?:^[-*+]\s+.+$\n?)+)/gm, (_match, list) => {
    const items = list
      .split(/\n/)
      .filter((line: string) => /^[-*+]\s/.test(line))
      .map((line: string) => `<li>${line.replace(/^[-*+]\s+/, '')}</li>`)
      .join('');
    return `<ul>${items}</ul>`;
  });

  // Ordered lists
  html = html.replace(/((?:^\d+\.\s+.+$\n?)+)/gm, (_match, list) => {
    const items = list
      .split(/\n/)
      .filter((line: string) => /^\d+\.\s/.test(line))
      .map((line: string) => `<li>${line.replace(/^\d+\.\s+/, '')}</li>`)
      .join('');
    return `<ol>${items}</ol>`;
  });

  // Paragraphs: wrap remaining non-empty, non-tag-only lines
  const lines = html.split('\n');
  const result: string[] = [];
  const blockTags = /^<\s*(\/)?(h[1-6]|ul|ol|li|pre|blockquote|hr|div|p)\b/;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) {
      result.push('');
      continue;
    }
    if (blockTags.test(line)) {
      result.push(line);
    } else {
      // Don't wrap if already inside a block context (simple heuristic)
      result.push(`<p>${line}</p>`);
    }
  }

  // Clean up empty paragraphs
  return result.join('\n').replace(/<p>\s*<\/p>/g, '');
}

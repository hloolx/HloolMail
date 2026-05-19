import { useText } from '../locales';
import { API_DOCS_MD_PATH } from '../lib/apiDocs';

interface ApiDocsMarkdownPreviewProps {
  markdown: string;
  isError: boolean;
  markdownURL: string;
}

function formatMarkdown(raw: string): string {
  let html = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g,
    '<pre style="background:var(--soft);padding:0.6rem;border-radius:0.4rem;overflow:auto;margin:0.5rem 0"><code>$2</code></pre>');
  // inline code
  html = html.replace(/`([^`]+)`/g,
    '<code style="background:var(--soft);padding:0.1rem 0.3rem;border-radius:0.25rem">$1</code>');
  // headings
  html = html.replace(/^### (.+)$/gm, '<h3 style="margin:0.8rem 0 0.3rem;font-size:1rem;font-weight:700;color:var(--foreground)">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="margin:1rem 0 0.3rem;font-size:1.2rem;font-weight:740;color:var(--foreground)">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="margin:1.2rem 0 0.3rem;font-size:1.4rem;font-weight:790;color:var(--foreground)">$1</h1>');
  // bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--foreground)">$1</strong>');
  // links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:var(--focus)" target="_blank" rel="noopener">$1</a>');
  // unordered lists
  html = html.replace(/^- (.+)$/gm, '<li style="margin-left:1.2rem;color:var(--foreground)">$1</li>');
  // paragraphs
  html = html.replace(/\n\n/g, '</p><p style="margin:0.4rem 0;line-height:1.65;color:var(--foreground)">');
  return `<p style="margin:0.4rem 0;line-height:1.65;color:var(--foreground)">${html}</p>`;
}

export function ApiDocsMarkdownPreview({ markdown, isError, markdownURL }: ApiDocsMarkdownPreviewProps) {
  const text = useText();

  return (
    <section className="api-docs-preview">
      <div className="panel-header">
        <div>
          <h2>{text.apiDocs.previewTitle}</h2>
          <p>{isError ? `${markdownURL} local fallback` : API_DOCS_MD_PATH}</p>
        </div>
      </div>
      <div
        className="api-docs-md-preview"
        dangerouslySetInnerHTML={{ __html: formatMarkdown(markdown) }}
      />
    </section>
  );
}

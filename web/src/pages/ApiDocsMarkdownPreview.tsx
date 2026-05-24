import { useText } from '../locales';
import { API_DOCS_MD_PATH } from '../lib/apiDocs';
import { simpleMarkdownToHTML } from '../lib/markdown';

interface ApiDocsMarkdownPreviewProps {
  markdown: string;
  isError: boolean;
  markdownURL: string;
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
        dangerouslySetInnerHTML={{ __html: simpleMarkdownToHTML(markdown) }}
      />
    </section>
  );
}

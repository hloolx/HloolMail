import { BookOpen, Bot, Check, Copy, Download, Link2 } from 'lucide-react';
import { useText } from '../locales';
import { useCopyState } from '../hooks/useCopyState';
import { copy } from '../lib/clipboard';
import { downloadMarkdown } from '../lib/download';

interface ApiDocsHeroProps {
  markdownURL: string;
  skillURL: string;
  prompt: string;
  markdown: string;
}

export function ApiDocsHero({ markdownURL, skillURL, prompt, markdown }: ApiDocsHeroProps) {
  const text = useText();
  const [docsCopied, markDocsCopied] = useCopyState();
  const [skillCopied, markSkillCopied] = useCopyState();
  const [promptCopied, markPromptCopied] = useCopyState();

  return (
    <section className="api-docs-hero">
      <div className="api-docs-hero-copy">
        <span className="home-kicker">
          <BookOpen size={14} />
          {text.page['api-docs']}
        </span>
        <h1>{text.apiDocs.title}</h1>
        <p>{text.apiDocs.desc}</p>
      </div>

      <div className="api-docs-handoff-grid">
        <article className="api-docs-handoff-card api-docs-md-card">
          <div className="api-docs-handoff-icon">
            <BookOpen size={18} />
          </div>
          <div>
            <h2>{text.apiDocs.mdLink}</h2>
            <p>{text.apiDocs.mdLinkHint}</p>
            <code>{markdownURL}</code>
            <div className="api-docs-mini-actions">
              <button className="btn-secondary" onClick={(event) => { copy(markdownURL, { celebrate: true, event, label: text.apiDocs.docsLinkCopied }); markDocsCopied(); }}>
                {docsCopied ? <Check size={15} /> : <Link2 size={15} />}
                {docsCopied ? text.common.copied : text.common.copyMdLink}
              </button>
              <button className="btn-primary" onClick={() => downloadMarkdown('hlool-mail-api-docs.md', markdown)}>
                <Download size={15} />
                {text.common.exportMd}
              </button>
            </div>
          </div>
        </article>
        <article className="api-docs-handoff-card">
          <div className="api-docs-handoff-icon">
            <Bot size={18} />
          </div>
          <div>
            <h2>{text.apiDocs.skillLink}</h2>
            <p>{text.apiDocs.skillLinkHint}</p>
            <code>{skillURL}</code>
            <div className="api-docs-mini-actions">
              <button className="btn-secondary" onClick={(event) => { copy(skillURL, { celebrate: true, event, label: text.apiDocs.skillLinkCopied }); markSkillCopied(); }}>
                {skillCopied ? <Check size={15} /> : <Link2 size={15} />}
                {skillCopied ? text.common.copied : text.apiDocs.copySkillLink}
              </button>
              <button className="btn-secondary" onClick={(event) => { copy(prompt, { celebrate: true, event, label: text.apiDocs.skillPromptCopied }); markPromptCopied(); }}>
                {promptCopied ? <Check size={15} /> : <Copy size={15} />}
                {promptCopied ? text.common.copied : text.apiDocs.copySkillPrompt}
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

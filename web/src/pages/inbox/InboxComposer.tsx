import type { RefObject } from 'react';
import { Loader2, MailPlus } from 'lucide-react';
import type { PublicDomainItem } from '../../api';
import type { Language } from '../../store';
import type { InboxText } from './types';
import { renderDomainOptions } from './utils';

type InboxComposerProps = {
  text: InboxText;
  language: Language;
  prefix: string;
  domainName: string;
  availabilityGroups: {
    publicDomains: PublicDomainItem[];
    privateDomains: PublicDomainItem[];
  };
  isGenerating: boolean;
  generateButtonRef: RefObject<HTMLButtonElement | null>;
  onPrefixChange: (value: string) => void;
  onDomainChange: (value: string) => void;
  onGenerate: () => void;
};

export function InboxComposer({
  text,
  language,
  prefix,
  domainName,
  availabilityGroups,
  isGenerating,
  generateButtonRef,
  onPrefixChange,
  onDomainChange,
  onGenerate
}: InboxComposerProps) {
  return (
    <div className="inbox-composer grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--soft)] p-3">
      <input
        className="input"
        placeholder={text.inbox.customPrefix}
        aria-label={text.inbox.customPrefix}
        value={prefix}
        onChange={(event) => onPrefixChange(event.target.value)}
      />
      <select className="input" value={domainName} onChange={(event) => onDomainChange(event.target.value)}>
        <option value="">{text.inbox.randomDomain}</option>
        {renderDomainOptions(availabilityGroups.privateDomains, text.domains.modePrivate, language)}
        {renderDomainOptions(availabilityGroups.publicDomains, text.domains.modePublic, language)}
      </select>
      <button ref={generateButtonRef} className="btn-primary" onClick={onGenerate} disabled={isGenerating}>
        {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <MailPlus size={16} />}
        {text.inbox.generate}
      </button>
    </div>
  );
}

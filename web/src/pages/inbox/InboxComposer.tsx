import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Check, ChevronDown, Globe2, Loader2, MailPlus, Sparkles, ShieldCheck } from 'lucide-react';
import type { PublicDomainItem } from '../../api';
import type { Language } from '../../store';
import { domainModeLabel } from '../../lib/display';
import type { InboxText } from './types';

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
      <DomainSelect
        text={text}
        language={language}
        value={domainName}
        availabilityGroups={availabilityGroups}
        onChange={onDomainChange}
      />
      <button ref={generateButtonRef} className="btn-primary" data-onboarding-target="create-mailbox" onClick={onGenerate} disabled={isGenerating}>
        {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <MailPlus size={16} />}
        {text.inbox.generate}
      </button>
    </div>
  );
}

type DomainSelectProps = {
  text: InboxText;
  language: Language;
  value: string;
  availabilityGroups: InboxComposerProps['availabilityGroups'];
  onChange: (value: string) => void;
};

type DomainSelectOption = {
  value: string;
  label: string;
  mode: PublicDomainItem['mode'];
  random?: boolean;
};

function DomainSelect({ text, language, value, availabilityGroups, onChange }: DomainSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const randomOption = useMemo<DomainSelectOption>(() => ({
    value: '',
    label: text.inbox.randomDomain,
    mode: 'public',
    random: true
  }), [text.inbox.randomDomain]);

  const privateOptions = useMemo(
    () => availabilityGroups.privateDomains.map(domainToOption),
    [availabilityGroups.privateDomains]
  );
  const publicOptions = useMemo(
    () => availabilityGroups.publicDomains.map(domainToOption),
    [availabilityGroups.publicDomains]
  );
  const allOptions = useMemo(
    () => [randomOption, ...privateOptions, ...publicOptions],
    [randomOption, privateOptions, publicOptions]
  );
  const selected = allOptions.find((option) => option.value === value) || randomOption;

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const choose = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="inbox-domain-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`inbox-domain-trigger ${open ? 'inbox-domain-trigger-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <DomainIcon option={selected} />
        <span className="inbox-domain-trigger-copy">
          <span className="inbox-domain-name">{selected.label}</span>
        </span>
        <ChevronDown size={15} className="inbox-domain-chevron" aria-hidden="true" />
      </button>

      {open && (
        <div className="inbox-domain-menu" role="listbox">
          <DomainOptionButton
            option={randomOption}
            active={selected.value === randomOption.value}
            language={language}
            onChoose={choose}
          />
          <DomainOptionGroup
            label={text.domains.modePrivate}
            options={privateOptions}
            selectedValue={selected.value}
            language={language}
            onChoose={choose}
          />
          <DomainOptionGroup
            label={text.domains.modePublic}
            options={publicOptions}
            selectedValue={selected.value}
            language={language}
            onChoose={choose}
          />
        </div>
      )}
    </div>
  );
}

function DomainOptionGroup({
  label,
  options,
  selectedValue,
  language,
  onChoose
}: {
  label: string;
  options: DomainSelectOption[];
  selectedValue: string;
  language: Language;
  onChoose: (value: string) => void;
}) {
  if (!options.length) return null;
  return (
    <div className="inbox-domain-option-group">
      <div className="inbox-domain-option-label">{label}</div>
      {options.map((option) => (
        <DomainOptionButton
          key={option.value}
          option={option}
          active={selectedValue === option.value}
          language={language}
          onChoose={onChoose}
        />
      ))}
    </div>
  );
}

function DomainOptionButton({
  option,
  active,
  language,
  onChoose
}: {
  option: DomainSelectOption;
  active: boolean;
  language: Language;
  onChoose: (value: string) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className={`inbox-domain-option ${active ? 'inbox-domain-option-active' : ''}`}
      onClick={() => onChoose(option.value)}
    >
      <DomainIcon option={option} />
      <span className="inbox-domain-option-copy">
        <span className="inbox-domain-name">{option.label}</span>
        <span className={`inbox-domain-pill inbox-domain-pill-${option.mode}`}>
          {domainModeLabel(option.mode, language)}
        </span>
      </span>
      <Check size={15} className="inbox-domain-check" aria-hidden="true" />
    </button>
  );
}

function DomainIcon({ option }: { option: DomainSelectOption }) {
  const className = `inbox-domain-icon inbox-domain-icon-${option.random ? 'random' : option.mode}`;
  if (option.random) return <Sparkles size={15} className={className} aria-hidden="true" />;
  if (option.mode === 'private') return <ShieldCheck size={15} className={className} aria-hidden="true" />;
  return <Globe2 size={15} className={className} aria-hidden="true" />;
}

function domainToOption(domain: PublicDomainItem): DomainSelectOption {
  return {
    value: domain.domain,
    label: domain.domain,
    mode: domain.mode
  };
}

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AtSign, Check, ChevronDown, Globe2, Loader2, MailPlus, Network, Sparkles, ShieldCheck } from 'lucide-react';
import type { PublicDomainItem } from '../../api';
import type { Language } from '../../store';
import { domainModeLabel } from '../../lib/display';
import type { InboxText } from './types';
import type { MailboxAddressType } from './useMailboxGeneration';

type InboxComposerProps = {
  text: InboxText;
  language: Language;
  prefix: string;
  domainName: string;
  addressType: MailboxAddressType;
  subdomain: string;
  availabilityGroups: {
    publicDomains: PublicDomainItem[];
    privateDomains: PublicDomainItem[];
  };
  isGenerating: boolean;
  generateButtonRef: RefObject<HTMLButtonElement | null>;
  onPrefixChange: (value: string) => void;
  onDomainChange: (value: string) => void;
  onAddressTypeChange: (value: MailboxAddressType) => void;
  onSubdomainChange: (value: string) => void;
  onGenerate: () => void;
};

export function InboxComposer({
  text,
  language,
  prefix,
  domainName,
  addressType,
  subdomain,
  availabilityGroups,
  isGenerating,
  generateButtonRef,
  onPrefixChange,
  onDomainChange,
  onAddressTypeChange,
  onSubdomainChange,
  onGenerate
}: InboxComposerProps) {
  return (
    <div className="inbox-composer grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--soft)] p-3">
      <div className="inbox-address-type" role="group" aria-label={text.inbox.addressType}>
        <AddressTypeButton
          icon="root"
          label={text.inbox.rootAddress}
          active={addressType === 'root'}
          onClick={() => onAddressTypeChange('root')}
        />
        <AddressTypeButton
          icon="subdomain"
          label={text.inbox.subdomainAddress}
          active={addressType === 'subdomain'}
          onClick={() => onAddressTypeChange('subdomain')}
        />
      </div>
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
        addressType={addressType}
        availabilityGroups={availabilityGroups}
        onChange={onDomainChange}
      />
      {addressType === 'subdomain' && (
        <input
          className="input"
          placeholder={text.inbox.customSubdomain}
          aria-label={text.inbox.customSubdomain}
          value={subdomain}
          onChange={(event) => onSubdomainChange(event.target.value)}
        />
      )}
      <button ref={generateButtonRef} className="btn-primary" data-onboarding-target="create-mailbox" onClick={onGenerate} disabled={isGenerating}>
        {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <MailPlus size={16} />}
        {text.inbox.generate}
      </button>
    </div>
  );
}

function AddressTypeButton({
  icon,
  label,
  active,
  onClick
}: {
  icon: MailboxAddressType;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = icon === 'subdomain' ? Network : AtSign;
  return (
    <button
      type="button"
      className={`inbox-address-type-choice ${active ? 'inbox-address-type-choice-active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon size={15} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

type DomainSelectProps = {
  text: InboxText;
  language: Language;
  value: string;
  addressType: MailboxAddressType;
  availabilityGroups: InboxComposerProps['availabilityGroups'];
  onChange: (value: string) => void;
};

type DomainSelectOption = {
  value: string;
  label: string;
  mode: PublicDomainItem['mode'] | 'available';
  pillLabel?: string;
  random?: boolean;
};

function DomainSelect({ text, language, value, addressType, availabilityGroups, onChange }: DomainSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const randomOption = useMemo<DomainSelectOption>(() => ({
    value: '',
    label: addressType === 'subdomain' ? text.inbox.randomWildcardDomain : text.inbox.randomDomain,
    mode: addressType === 'subdomain' ? 'available' : 'public',
    pillLabel: addressType === 'subdomain' ? text.inbox.availableParentDomain : text.domains.modePublic,
    random: true
  }), [addressType, text.domains.modePublic, text.inbox.availableParentDomain, text.inbox.randomDomain, text.inbox.randomWildcardDomain]);

  const privateOptions = useMemo(
    () => availabilityGroups.privateDomains.filter((domain) => domainSupportsAddressType(domain, addressType)).map(domainToOption),
    [addressType, availabilityGroups.privateDomains]
  );
  const publicOptions = useMemo(
    () => availabilityGroups.publicDomains.filter((domain) => domainSupportsAddressType(domain, addressType)).map(domainToOption),
    [addressType, availabilityGroups.publicDomains]
  );
  const allOptions = useMemo(
    () => [randomOption, ...privateOptions, ...publicOptions],
    [randomOption, privateOptions, publicOptions]
  );
  const selected = allOptions.find((option) => option.value === value) || randomOption;

  useEffect(() => {
    if (value && !allOptions.some((option) => option.value === value)) onChange('');
  }, [allOptions, onChange, value]);

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
          {option.pillLabel || domainModeLabel(option.mode as PublicDomainItem['mode'], language)}
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

function domainSupportsAddressType(domain: PublicDomainItem, addressType: MailboxAddressType) {
  if (addressType === 'subdomain') return domain.wildcard_ready === true || domain.capabilities?.includes('subdomain_mailbox') === true;
  return domain.root_ready !== false && domain.capabilities?.includes('subdomain_mailbox') !== true
    ? true
    : domain.root_ready === true || domain.capabilities?.includes('root_mailbox') === true;
}

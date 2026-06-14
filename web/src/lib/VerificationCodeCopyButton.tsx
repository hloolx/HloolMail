import type { MouseEvent } from 'react';
import { Check, Copy as CopyIcon } from 'lucide-react';

import { useCopyState } from '../hooks/useCopyState';
import { useText } from '../locales';
import { copy as copyText } from './clipboard';

export function VerificationCodeCopyButton({ code, compact = false, className = '' }: { code: string; compact?: boolean; className?: string }) {
  const text = useText();
  const [copied, markCopied] = useCopyState();
  const title = copied ? text.common.copied : text.inbox.copyCode;

  const handleCopy = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void copyText(code, { event }).then((ok) => {
      if (ok) markCopied();
    });
  };

  return (
    <button
      type="button"
      className={`verification-code-copy ${compact ? 'verification-code-copy-compact' : ''} ${className}`.trim()}
      title={title}
      aria-label={`${title}: ${code}`}
      onClick={handleCopy}
    >
      <span className="verification-code-copy-value">{code}</span>
      {copied ? <Check size={compact ? 13 : 15} /> : <CopyIcon size={compact ? 13 : 15} />}
    </button>
  );
}

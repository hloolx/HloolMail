import { Check, Copy } from 'lucide-react';
import type { DNSRecord } from '../../types';
import { useCopyState } from '../../hooks/useCopyState';
import { copy } from '../../lib/clipboard';

export function DNSRecordRow({ record }: { record: DNSRecord }) {
  const value = record.priority ? `${record.priority} ${record.value}` : record.value;
  const [dnsCopied, markDnsCopied] = useCopyState();
  return (
    <div className="dns-row">
      <span>{record.type}</span>
      <code>{record.name}</code>
      <button className="btn-ghost" onClick={() => { copy(value); markDnsCopied(); }}>
        {dnsCopied ? <Check size={14} /> : <Copy size={14} />}
        {dnsCopied ? 'Copied' : 'Copy'}
      </button>
      <code>{value}</code>
    </div>
  );
}

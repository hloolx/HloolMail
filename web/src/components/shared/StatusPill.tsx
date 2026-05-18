import { Check, Loader2, X } from 'lucide-react';

export function StatusPill({ ok, loading, children }: { ok?: boolean; loading?: boolean; children: string }) {
  return (
    <span className={`status-pill ${loading ? 'status-loading' : ok ? 'status-ok' : 'status-bad'}`}>
      {loading ? <Loader2 size={13} className="animate-spin" /> : ok ? <Check size={13} /> : <X size={13} />}
      {children}
    </span>
  );
}

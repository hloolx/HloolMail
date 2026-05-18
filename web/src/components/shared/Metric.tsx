import type { LucideIcon } from 'lucide-react';
import { useCountUp } from '../../hooks/useCountUp';

export function Metric({ icon: Icon, label, value, loading }: { icon: LucideIcon; label: string; value: number; loading?: boolean }) {
  const animated = useCountUp(value);
  return (
    <div className="metric">
      <div className="metric-icon">
        <Icon size={16} />
      </div>
      <div>
        <div className="text-xs text-[var(--muted)]">{label}</div>
        <div className="text-xl font-semibold metric-value">
          {loading ? <span className="metric-loading" aria-busy="true" /> : animated.toLocaleString()}
        </div>
      </div>
    </div>
  );
}

import { AlertTriangle, type LucideIcon } from 'lucide-react';
import { useText } from '../../../locales';
import { useCountUp } from '../../../hooks/useCountUp';
import { LineChart } from '../../../components/charts/LineChart';
import {
  formatNumber,
  formatSignedNumber,
  percentage
} from '../utils/adminFormatting';

export function SummaryMetric({
  icon: Icon,
  label,
  value,
  growth,
  growthLabel,
  loading,
  onClick
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  growth: number;
  growthLabel: string;
  loading: boolean;
  onClick?: () => void;
}) {
  const animated = useCountUp(value);
  const content = (
    <>
      <span className="admin-summary-icon"><Icon size={17} aria-hidden="true" /></span>
      <span className="admin-summary-copy">
        <span className="admin-summary-label">{label}</span>
        <strong>{loading ? <span className="metric-loading" aria-busy="true" /> : animated.toLocaleString()}</strong>
        <small>{growthLabel.replace('{count}', formatSignedNumber(growth))}</small>
      </span>
    </>
  );
  if (onClick) {
    return (
      <button className="admin-summary-metric admin-summary-metric-clickable" type="button" onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className="admin-summary-metric">{content}</div>;
}

export function TrendPanel({
  title,
  data,
  labels,
  color,
  unit,
  loading,
  emptyLabel
}: {
  title: string;
  data: number[];
  labels: string[];
  color: string;
  unit: string;
  loading: boolean;
  emptyLabel: string;
}) {
  return (
    <div className="admin-trend-panel">
      <h3>{title}</h3>
      <LineChart data={data} labels={labels} color={color} unit={unit} loading={loading} emptyLabel={emptyLabel} ariaLabel={title} />
    </div>
  );
}

export function BreakdownPanel({
  title,
  total,
  items
}: {
  title: string;
  total: number;
  items: Array<{ label: string; value: number; tone: 'good' | 'bad' | 'focus' | 'neutral' }>;
}) {
  return (
    <section className="panel admin-breakdown-panel">
      <div className="admin-breakdown-header">
        <h2>{title}</h2>
        <span>{formatNumber(total)}</span>
      </div>
      <div className="admin-breakdown-list">
        {items.map((item) => (
          <div className={`admin-breakdown-row admin-breakdown-${item.tone}`} key={item.label}>
            <div>
              <span>{item.label}</span>
              <b>{formatNumber(item.value)}</b>
            </div>
            <div className="admin-breakdown-track" aria-hidden="true">
              <span style={{ width: `${percentage(item.value, total)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function DashboardAlert({ label, onRetry, compact = false }: { label: string; onRetry: () => void; compact?: boolean }) {
  const text = useText();
  return (
    <div className={`dashboard-alert dashboard-alert-critical ${compact ? 'admin-dashboard-alert-compact' : ''}`} role="alert">
      <AlertTriangle size={16} aria-hidden="true" />
      <span>{label}</span>
      <button className="btn-ghost" type="button" style={{ marginLeft: 'auto' }} onClick={onRetry}>
        {text.common.retry}
      </button>
    </div>
  );
}

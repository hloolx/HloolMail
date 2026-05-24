import { useText } from '../../locales';
import { useAppStore } from '../../store';

export function QuotaThermometer({ used, limit }: { used: number; limit: number }) {
  const text = useText();
  const language = useAppStore((state) => state.language);
  const unlimited = limit <= 0;
  if (unlimited) {
    return (
      <div className="quota-thermo quota-thermo-unlimited" title={text.apiKeys.unlimited}>
        <span className="quota-thermo-infinity">{text.apiKeys.unlimitedShort}</span>
      </div>
    );
  }

  const ratio = Math.min(1, Math.max(0, used / Math.max(limit, 1)));
  const formatter = new Intl.NumberFormat(language);
  const label = `${formatter.format(used)} / ${formatter.format(limit)}`;

  return (
    <div className="quota-thermo" title={label}>
      <span className="quota-thermo-value">{label}</span>
      <span className="quota-thermo-track">
        <span style={{ width: `${Math.round(ratio * 100)}%` }} />
      </span>
    </div>
  );
}

import { useRef, useState } from 'react';
import type React from 'react';
import { Activity } from 'lucide-react';

function formatChartLabel(label: string): string {
  // Expects "YYYY-MM-DD" format; extracts "MM-DD"
  const parts = label.split('-');
  if (parts.length === 3) return `${parts[1]}-${parts[2]}`;
  return label;
}

function shouldShowXAxisLabel(index: number, total: number): boolean {
  if (total <= 8) return true;
  const lastIndex = total - 1;
  const stride = Math.max(1, Math.ceil(lastIndex / 6));
  return index === 0 || index === lastIndex || index % stride === 0;
}

export function LineChart({
  data,
  labels,
  color,
  unit,
  emptyLabel = 'No data',
  loading = false,
  loadingLabel,
  ariaLabel,
}: {
  data: number[];
  labels: string[];
  color: string;
  unit: string;
  emptyLabel?: string;
  loading?: boolean;
  loadingLabel?: string;
  ariaLabel?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<{ index: number; x: number; y: number } | null>(null);

  if (loading) {
    return (
      <div className="chart-wrap chart-loading" role="status" aria-live="polite" aria-label={loadingLabel || ariaLabel || emptyLabel}>
        <svg viewBox="0 0 400 180" className="chart-svg chart-skeleton-svg" aria-hidden="true">
          {[34, 68, 102, 136].map((y) => (
            <line key={y} x1="12" y1={y} x2="388" y2={y} stroke="var(--border)" strokeWidth="0.5" />
          ))}
          <path
            className="chart-skeleton-area"
            d="M12,132 C58,118 76,86 120,96 C166,106 182,52 228,66 C270,79 294,116 334,94 C358,81 376,74 388,66 L388,164 L12,164 Z"
          />
          <path
            className="chart-skeleton-line"
            d="M12,132 C58,118 76,86 120,96 C166,106 182,52 228,66 C270,79 294,116 334,94 C358,81 376,74 388,66"
          />
        </svg>
        <div className="chart-x-labels chart-skeleton-labels" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
        </div>
      </div>
    );
  }

  if (!data.length || !labels.length) {
    return (
      <div className="chart-empty">
        <Activity size={20} />
        <span>{emptyLabel}</span>
      </div>
    );
  }

  const maxVal = Math.max(...data, 1);
  const padding = { top: 16, right: 12, bottom: 28, left: 12 };
  const width = 400;
  const height = 180;
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const steps = data.length - 1;

  const points = data.map((val, i) => {
    const x = padding.left + (steps > 0 ? (i / steps) * chartW : chartW / 2);
    const y = padding.top + chartH - (val / maxVal) * chartH;
    return `${x},${y}`;
  });

  const areaPath = `${points.join(' L ')} L ${padding.left + chartW},${padding.top + chartH} L ${padding.left},${padding.top + chartH} Z`;
  const linePath = points.join(' L ');
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((frac) => padding.top + chartH - frac * chartH);

  const handlePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const screenMatrix = svg.getScreenCTM();
    if (!screenMatrix) return;
    const svgP = pt.matrixTransform(screenMatrix.inverse());
    const relX = (svgP.x - padding.left) / chartW;
    const idx = Math.round(relX * steps);
    if (idx < 0 || idx >= data.length) {
      setTooltip(null);
      return;
    }
    const px = padding.left + (steps > 0 ? (idx / steps) * chartW : chartW / 2);
    const py = padding.top + chartH - (data[idx] / maxVal) * chartH;
    setTooltip({ index: idx, x: px, y: Math.max(padding.top, py - 8) });
  };

  return (
    <div className="chart-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
        role="img"
        aria-label={ariaLabel}
        onPointerMove={handlePointer}
        onPointerLeave={() => setTooltip(null)}
      >
        {gridLines.map((y, i) => (
          <line key={i} x1={padding.left} y1={y} x2={padding.left + chartW} y2={y} stroke="var(--border)" strokeWidth="0.5" />
        ))}
        <path d={areaPath} fill={color} fillOpacity="0.08" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((pt, i) => {
          const [cx, cy] = pt.split(',').map(Number);
          return <circle key={i} cx={cx} cy={cy} r="2.5" fill={color} stroke="var(--panel)" strokeWidth="1.2" />;
        })}
        {tooltip && (
          <>
            <line x1={tooltip.x} y1={padding.top} x2={tooltip.x} y2={padding.top + chartH} stroke={color} strokeWidth="0.8" strokeDasharray="3 2" />
            <rect x={tooltip.x - 30} y={padding.top} width={60} height={22} rx="4" fill="var(--foreground)" />
            <text x={tooltip.x} y={padding.top + 14} textAnchor="middle" fill="var(--background)" fontSize="11" fontWeight="600">
              {data[tooltip.index].toLocaleString()}{unit ? ` ${unit}` : ''}
            </text>
          </>
        )}
      </svg>
      <div className="chart-x-labels">
        {labels.map((label, i) => (
          <span key={i}>{shouldShowXAxisLabel(i, labels.length) ? formatChartLabel(label) : ''}</span>
        ))}
      </div>
    </div>
  );
}

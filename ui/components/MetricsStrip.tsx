import type { MetricsResponse } from '@itr/shared';
import { ChartBar, CheckCircle, XCircle, Lightning, Timer } from '@phosphor-icons/react/dist/ssr';

interface Props { metrics: MetricsResponse }

function fmt(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function MetricsStrip({ metrics }: Props) {
  const items = [
    { icon: <ChartBar size={18} />, label: 'Total Runs',    value: metrics.totalRuns,                  color: '#f97316' },
    { icon: <CheckCircle size={18} />, label: 'Success Rate', value: `${metrics.successRate}%`,           color: '#22c55e' },
    { icon: <XCircle size={18} />, label: 'Failures',       value: metrics.failureCount,               color: '#ef4444' },
    { icon: <Lightning size={18} />, label: 'Active',       value: metrics.activeRuns,                 color: '#60a5fa' },
    { icon: <Timer size={18} />, label: 'p50 Duration',     value: fmt(metrics.p50DurationMs),         color: '#a78bfa' },
    { icon: <Timer size={18} />, label: 'p99 Duration',     value: fmt(metrics.p99DurationMs),         color: '#a78bfa' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
      {items.map((item) => (
        <div key={item.label} className="card flex flex-col gap-1" style={{ padding: '14px 16px' }}>
          <div className="flex items-center gap-2" style={{ color: item.color }}>
            {item.icon}
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.label}</span>
          </div>
          <div className="text-xl font-bold" style={{ color: item.color }}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

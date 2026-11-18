import { formatDistanceToNow } from 'date-fns';
import { useServiceHistory, useServiceUptime } from '@/hooks/use-services';
import type { Service, UptimeBucket } from '@/types/api';

function barClass(bucket: UptimeBucket): string {
  if (bucket.checks === 0) return 'bg-muted/50';
  if (bucket.successes === bucket.checks) return 'bg-[var(--chart-2)]';
  if (bucket.successes > 0) return 'bg-amber-500';
  return 'bg-destructive';
}

function uptimePercent(buckets: UptimeBucket[]): string | null {
  const checks = buckets.reduce((sum, bucket) => sum + bucket.checks, 0);
  if (checks === 0) return null;
  const successes = buckets.reduce((sum, bucket) => sum + bucket.successes, 0);
  return `${((successes / checks) * 100).toFixed(1)}%`;
}

function Sparkline({ buckets }: { buckets: UptimeBucket[] }) {
  const points = buckets
    .filter((bucket) => bucket.checks > 0 && bucket.avg_latency > 0)
    .map((bucket) => bucket.avg_latency);
  if (points.length < 2) return <span className="text-[10px] text-muted-foreground">—</span>;
  const max = Math.max(...points, 1);
  const line = points
    .map((latency, index) => `${(index / (points.length - 1)) * 100},${24 - (latency / max) * 20}`)
    .join(' ');
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-24" aria-label="24-hour latency">
      <polyline points={line} fill="none" stroke="var(--chart-1)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function ServiceUptime({ service }: { service: Service }) {
  const hourly = useServiceUptime(service.id, 'hour', 24);
  const daily = useServiceUptime(service.id, 'day', 30);
  const history = useServiceHistory(service.id);

  if (hourly.isLoading || daily.isLoading) {
    return <div className="mt-3 h-12 animate-pulse rounded bg-muted/40" />;
  }
  if (hourly.error || daily.error || !hourly.data || !daily.data) {
    return <p className="mt-2 text-xs text-muted-foreground">Uptime unavailable</p>;
  }

  const percent = uptimePercent(daily.data);
  const lastFailure = history.data?.find((check) => check.status !== 'online');

  return (
    <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="w-7 shrink-0 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">24h</span>
          <div className="flex h-3 flex-1 gap-px" aria-label="Hourly uptime, last 24 hours">
            {hourly.data.map((bucket) => (
              <span
                key={bucket.start_at}
                title={`${bucket.start_at}: ${bucket.checks ? `${bucket.successes}/${bucket.checks} up` : 'no data'}`}
                className={`h-full flex-1 rounded-sm ${barClass(bucket)}`}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-7 shrink-0 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">30d</span>
          <div className="flex h-3 flex-1 gap-px" aria-label="Daily uptime, last 30 days">
            {daily.data.map((bucket) => (
              <span
                key={bucket.start_at}
                title={`${bucket.start_at}: ${bucket.checks ? `${bucket.successes}/${bucket.checks} up` : 'no data'}`}
                className={`h-full flex-1 rounded-sm ${barClass(bucket)}`}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-end justify-between gap-3 md:justify-end">
        <div className="text-right">
          <p className="font-mono text-sm font-semibold tabular-nums">{percent ?? '—'}</p>
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">30d uptime</p>
        </div>
        <Sparkline buckets={hourly.data} />
        <div className="text-right">
          <p className="max-w-[16rem] truncate font-mono text-[10px] text-muted-foreground">
            {lastFailure
              ? `Last failure ${formatDistanceToNow(new Date(lastFailure.checked_at), { addSuffix: true })}`
              : 'No failures'}
          </p>
          {lastFailure && (
            <p className="max-w-[16rem] truncate font-mono text-[10px] text-destructive">
              {lastFailure.error_message || `HTTP ${lastFailure.status_code ?? '—'}`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

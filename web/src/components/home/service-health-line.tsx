import { Link } from 'react-router-dom';
import { useAllServicesStats, useServices } from '@/hooks/use-services';

/** One compact admin-only line about the monitored services. */
export function ServiceHealthLine({ className }: { className?: string }) {
  const services = useServices();
  const stats = useAllServicesStats();

  if (services.isLoading || stats.isLoading) {
    return <div className={`h-5 w-64 animate-pulse rounded bg-muted ${className ?? ''}`} />;
  }

  if (services.error || stats.error || !services.data) {
    return (
      <Link to="/dashboard/services" className={`text-xs text-muted-foreground hover:text-primary ${className ?? ''}`}>
        Service health unavailable · open Services
      </Link>
    );
  }

  const up = services.data.filter((service) => service.current_status === 'online').length;
  const total = services.data.length;
  const down = services.data.filter(
    (service) => service.current_status === 'offline' || service.current_status === 'degraded',
  );
  const uptime =
    stats.data && stats.data.total_checks > 0
      ? `${((stats.data.successful_checks / stats.data.total_checks) * 100).toFixed(1)}%`
      : null;

  return (
    <Link
      to="/dashboard/services"
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted-foreground hover:text-primary ${className ?? ''}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${down.length ? 'bg-destructive' : 'bg-[var(--chart-2)]'}`} />
      <span>
        {up}/{total} services up
        {uptime ? ` · ${uptime} (24h)` : ''}
      </span>
      {down.length > 0 && <span className="text-destructive">· down: {down.map((service) => service.name).join(', ')}</span>}
    </Link>
  );
}

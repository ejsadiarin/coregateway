import { Link } from 'react-router-dom';
import { Odometer } from '@/components/ui/odometer';
import { useServices } from '@/hooks/use-services';

/** One compact admin-only line about the monitored services. */
export function ServiceHealthLine({ className }: { className?: string }) {
  const services = useServices();

  if (services.isLoading) {
    return <div className={`h-5 w-64 animate-pulse rounded bg-muted ${className ?? ''}`} />;
  }

  if (services.error || !services.data) {
    return (
      <Link to="/dashboard/services" className={`text-xs text-muted-foreground hover:text-primary ${className ?? ''}`}>
        Service health unavailable · open Services
      </Link>
    );
  }

  const active = services.data.filter((service) => service.is_active);
  const up = active.filter((service) => service.current_status === 'online').length;
  const total = active.length;
  const down = active.filter(
    (service) => service.current_status === 'offline' || service.current_status === 'degraded',
  );

  return (
    <Link
      to="/dashboard/services"
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted-foreground hover:text-primary ${className ?? ''}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${down.length ? 'bg-destructive' : 'bg-[var(--chart-2)]'}`} />
      <span>
        <Odometer value={up} format={String} />/{total} services up
      </span>
      {down.length > 0 && <span className="text-destructive">· down: {down.map((service) => service.name).join(', ')}</span>}
    </Link>
  );
}

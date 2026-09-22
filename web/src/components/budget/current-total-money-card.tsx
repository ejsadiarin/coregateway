
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCurrentTotalMoney } from '@/hooks/use-budget';
import { formatPeso } from '@/lib/format';
import { Wallet } from 'lucide-react';

interface CurrentTotalMoneyCardProps {
  className?: string;
}

export function CurrentTotalMoneyCard({ className }: CurrentTotalMoneyCardProps) {
  const { data, isLoading, error } = useCurrentTotalMoney();

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Total Money · lifetime</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 animate-pulse">
            <div className="h-8 w-40 bg-muted rounded" />
            <div className="h-3 w-24 bg-muted rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Total Money · lifetime</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Failed to load total money</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Total Money · lifetime</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Lifetime total</p>
            <div className="text-3xl font-bold font-mono tabular-nums">
              {formatPeso(data.total_money)}
            </div>
          </div>
          <div className="p-3 rounded-full bg-primary/10">
            <Wallet className="h-5 w-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

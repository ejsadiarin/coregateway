
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCurrentTotalMoney } from '@/hooks/use-budget';
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
          <div className="h-16 flex items-center justify-center">
            <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
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
            <div className="text-3xl font-bold">
              ₱{data.total_money.toLocaleString()}
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


import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, Receipt, ArrowDownLeft } from "lucide-react";
import { formatPeso, formatCount } from "@/lib/format";
import type { SummaryStats } from "@/types/api";

interface ExpenseStatsProps {
  stats: SummaryStats | undefined;
  isLoading?: boolean;
}

export function ExpenseStats({ stats, isLoading }: ExpenseStatsProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 w-24 bg-muted rounded" />
              <div className="h-4 w-4 bg-muted rounded" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-32 bg-muted rounded mb-1" />
              <div className="h-3 w-20 bg-muted rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  const totalExpense = Number(stats.total_expenses) || 0;
  const totalIncome = Number(stats.total_incomes) || 0;
  const expenseCount = stats.expense_count ?? 0;
  const incomeCount = stats.income_count ?? 0;
  const remaining = totalIncome - totalExpense;

  const statCards = [
    {
      title: "Total Income",
      value: formatPeso(totalIncome),
      description: `${formatCount(incomeCount)} transactions`,
      icon: ArrowDownLeft,
      iconColor: "text-green-500",
    },
    {
      title: "Total Spent",
      value: formatPeso(totalExpense),
      description: `${formatCount(expenseCount)} transactions`,
      icon: DollarSign,
      iconColor: "text-red-500",
    },
    {
      title: "Avg per Transaction",
      value: expenseCount > 0
        ? formatPeso(totalExpense / expenseCount)
        : formatPeso(0),
      description: "average expense amount",
      icon: TrendingUp,
      iconColor: "text-muted-foreground",
    },
    {
      title: "Net Balance",
      value: formatPeso(remaining),
      description: remaining >= 0 ? "on track" : "over budget",
      icon: Receipt,
      iconColor: remaining >= 0 ? "text-green-500" : "text-red-500",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {statCards.map((stat, index) => {
        const Icon = stat.icon;
        return (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <Icon className={`h-4 w-4 ${stat.iconColor}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold font-mono tabular-nums ${stat.iconColor}`}>{stat.value}</div>
              <p className="text-xs text-muted-foreground">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

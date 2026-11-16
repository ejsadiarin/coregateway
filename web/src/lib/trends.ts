// corefinance returns trend months newest first. latestTwo gives the newest
// month and the one before it regardless of the input order.
export function latestTwo<T extends { month: string }>(trends: T[] | undefined): {
  latest?: T;
  previous?: T;
} {
  const series = [...(trends ?? [])].sort((a, b) => a.month.localeCompare(b.month));
  return { latest: series[series.length - 1], previous: series[series.length - 2] };
}

import { useQuery } from "@tanstack/react-query";
import { FRESH_MS, fetchSeries, loadRates, saveRates } from "@/lib/exchange";

// useExchangeRates starts from the copy saved on this device and refreshes it
// once it is an hour old. A failed refresh keeps the copy, with isError set.
export function useExchangeRates() {
  return useQuery({
    queryKey: ["exchange", "rates"],
    queryFn: async ({ signal }) => {
      const series = await fetchSeries(new Date(), signal);
      saveRates(series);
      return series;
    },
    initialData: () => loadRates()?.series,
    initialDataUpdatedAt: () => loadRates()?.fetchedAt,
    staleTime: FRESH_MS,
    refetchInterval: FRESH_MS,
    retry: 1,
    // Offline, try and fail rather than pause, so the page can say so.
    networkMode: "always",
    refetchOnReconnect: true,
  });
}

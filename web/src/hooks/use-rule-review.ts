import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchRuleFeed, RULE_FEED_PAGE } from "@/lib/ledger-api";
import type { LedgerKind } from "@/lib/ledger";
import { loadCursor, readFeedSince, saveCursor } from "@/lib/rule-review";

// localStore is this browser's storage, or undefined where reading it
// throws (some private windows).
function localStore(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const reviewKey = (kind: LedgerKind) => ["rule-review", kind] as const;

interface Review {
  // ids are the kind's rule entries written since the owner last marked
  // them reviewed, in the order they were written.
  ids: string[];
  // next is where "Mark reviewed" moves the cursor to.
  next: string | undefined;
}

// useRuleReview reads the rule entries of one kind written since this
// browser last marked them reviewed (coregateway #13). A first visit marks
// nothing new: it only records where the feed ends. A failed read (the
// network, or a cursor the feed rejects) keeps the cursor and shows
// nothing; the next read tries again, so nothing unreviewed is lost.
export function useRuleReview(kind: LedgerKind) {
  const qc = useQueryClient();
  const q = useQuery<Review>({
    queryKey: reviewKey(kind),
    queryFn: async () => {
      const store = localStore();
      const after = loadCursor(kind, store);
      if (after) return readFeedSince(after, fetchRuleFeed, kind, RULE_FEED_PAGE);
      const { next } = await readFeedSince(undefined, fetchRuleFeed, kind, RULE_FEED_PAGE);
      if (next) saveCursor(kind, next, store);
      return { ids: [], next };
    },
    staleTime: 60000,
  });

  const markReviewed = () => {
    const next = q.data?.next;
    if (!next) return;
    saveCursor(kind, next, localStore());
    qc.setQueryData<Review>(reviewKey(kind), { ids: [], next });
  };

  return { ids: q.data?.ids ?? [], markReviewed };
}

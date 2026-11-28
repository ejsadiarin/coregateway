import { QueryClient, onlineManager } from '@tanstack/react-query'
import { createStore, del, get, set } from 'idb-keyval'
import { createLastSeenPersister, type LastSeenPersister, type LastSeenStore } from '@/lib/last-seen'

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // Last-seen data has no age limit (ADR-0009): a read nothing
            // shows is still kept, in memory and on the device, until a fresh
            // load replaces it or the owner signs out. Reads that churn (Feed
            // searches, its budget batches) set their own shorter time.
            gcTime: Infinity,
        },
        mutations: {
            // Writes aren't queued yet (the Outbox queue, ADR-0009, is to
            // come): offline one fails and says so rather than waiting.
            networkMode: 'always',
        },
    }
})

// React Query starts out believing it is online and only learns otherwise
// from an `offline` event, which a page opened with no connection never
// gets: without this its reads would fail and retry instead of pausing on
// the last-seen data.
if (typeof navigator !== 'undefined') onlineManager.setOnline(navigator.onLine)

const idb = createStore('core-last-seen', 'last-seen')
const store: LastSeenStore = {
    get: (key) => get(key, idb),
    set: (key, value) => set(key, value, idb),
    del: (key) => del(key, idb),
}

const persisters = new Map<string, LastSeenPersister>()

// lastSeenPersister is the one persister for an account's last-seen data.
export function lastSeenPersister(userId: string): LastSeenPersister {
    let p = persisters.get(userId)
    if (!p) {
        p = createLastSeenPersister(userId, store)
        persisters.set(userId, p)
    }
    return p
}

// A write still waiting out its throttle goes now when the page is hidden
// or left, so a quick look before closing the app is kept too.
if (typeof window !== 'undefined') {
    const flushAll = () => persisters.forEach((p) => p.flush())
    window.addEventListener('pagehide', flushAll)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushAll()
    })
}

// forgetLastSeen is signing out: the account's last-seen data is deleted
// from the device and from memory, and nothing more is written for it.
export async function forgetLastSeen(userId: string): Promise<void> {
    const p = lastSeenPersister(userId)
    persisters.delete(userId)
    await p.close()
    queryClient.clear()
}

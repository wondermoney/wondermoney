import type { QueryClient } from "@tanstack/react-query";

/**
 * Server-rendered data handed to React Query, and the rule that lets it win.
 *
 * Pages fetch on the server and pass the result to their client component, which seeds the
 * matching query with it. React Query only applies `initialData` when it *creates* a query:
 * once the key is cached (from an earlier page, a layout gate, a prefetch) the server data is
 * ignored, and inside the 60s `staleTime` nothing refetches either. So a page could show a
 * minute-old cache entry while the server had just rendered newer data.
 *
 * So this keeps `initialData` as the seeding mechanism and adds a timestamp:
 *
 * - The page stamps its render with {@link serverDataTimestamp} before it fetches, and passes
 *   the stamp to the client component.
 * - The client seeds each query with {@link serverSeed}, which sets `initialData` plus
 *   `initialDataUpdatedAt`.
 * - {@link preferNewerServerData}, installed on the app's QueryClient, replaces a cached entry
 *   with the seed when the component mounts, if the seed is newer than what is cached. Cached
 *   data that is newer than the server's snapshot (a mutation's refetch, or an older RSC
 *   payload replayed by back/forward navigation) is kept.
 */

/** When a server component's data is current as of. Take it before the fetches start. */
export function serverDataTimestamp(): number {
  return Date.now();
}

export interface ServerSeed<T> {
  initialData?: T;
  initialDataUpdatedAt?: () => number;
}

/**
 * Query options that seed a query with server data rendered at `renderedAt`. Spread it into a
 * hook's options; `undefined` data seeds nothing.
 *
 * The stamp is clamped to the browser's clock: a server clock ahead of the browser would
 * otherwise date the data in the future and keep it "fresh" past `staleTime`.
 */
export function serverSeed<T>(
  data: T | undefined,
  renderedAt: number | undefined,
): ServerSeed<T> {
  if (data === undefined) return {};
  if (renderedAt === undefined) return { initialData: data };
  return {
    initialData: data,
    initialDataUpdatedAt: () => Math.min(renderedAt, Date.now()),
  };
}

/**
 * Makes a mounting query adopt its server seed when the seed is newer than the cache entry.
 * It acts once per observer, when the observer first subscribes (the component mounted), and
 * not when the same observer later moves to another key: the seed describes the key the
 * server rendered, never a filter the user picked afterwards. Queries seeded without a
 * timestamp keep React Query's own behaviour.
 *
 * Returns the unsubscribe function.
 */
export function preferNewerServerData(queryClient: QueryClient): () => void {
  const mounted = new WeakSet<object>();

  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "observerAdded") return;
    const { observer, query } = event;
    if (mounted.has(observer)) return;
    mounted.add(observer);

    const { initialData, initialDataUpdatedAt } = observer.options;
    if (initialData === undefined || initialDataUpdatedAt === undefined) return;

    const seededAt =
      typeof initialDataUpdatedAt === "function"
        ? initialDataUpdatedAt()
        : initialDataUpdatedAt;
    if (seededAt === undefined) return;

    const cachedAt = query.state.dataUpdatedAt;
    if (query.state.data !== undefined && cachedAt >= seededAt) return;

    const seed =
      typeof initialData === "function"
        ? (initialData as () => unknown)()
        : initialData;
    if (seed === undefined) return;

    queryClient.setQueryData(query.queryKey, seed, { updatedAt: seededAt });
  });
}

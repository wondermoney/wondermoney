import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False on the server and during hydration, true afterwards. Replaces the
 * `useState(false)` + `useEffect(() => setMounted(true))` pattern without the
 * extra effect-driven render.
 */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

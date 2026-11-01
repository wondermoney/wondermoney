import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readItem(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Blocked storage reads as "not set".
    return null;
  }
}

/**
 * The raw localStorage value for `key`, read on every render and refreshed by
 * cross-tab `storage` events. Null on the server, during hydration, when the
 * key is absent, or when storage is blocked.
 */
export function useLocalStorageItem(key: string) {
  return useSyncExternalStore(
    subscribe,
    () => readItem(key),
    () => null,
  );
}

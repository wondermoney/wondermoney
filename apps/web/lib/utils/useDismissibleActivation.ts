"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const DEFAULT_DISMISSAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

function readRaw(storageKey: string) {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function isStillDismissed(rawValue: string | null) {
  if (!rawValue) return false;
  const dismissedUntil = Number(rawValue);
  return Number.isFinite(dismissedUntil) && dismissedUntil > Date.now();
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function useDismissibleActivation(key: string, durationMs = DEFAULT_DISMISSAL_DURATION_MS) {
  const storageKey = `wm:${key}:dismissedUntil`;
  const storedDismissed = useSyncExternalStore(
    subscribe,
    () => isStillDismissed(readRaw(storageKey)),
    () => false,
  );
  // Dismissal still applies locally when storage is blocked.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  // Drop an expired or malformed entry.
  useEffect(() => {
    const rawValue = readRaw(storageKey);
    if (!rawValue || isStillDismissed(rawValue)) return;
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Ignore blocked storage and fall back to not dismissed.
    }
  }, [storageKey]);

  const dismiss = useCallback(() => {
    const dismissedUntil = Date.now() + durationMs;
    try {
      window.localStorage.setItem(storageKey, String(dismissedUntil));
    } catch {
      // Ignore blocked storage and still dismiss locally.
    }
    setDismissedKey(storageKey);
  }, [durationMs, storageKey]);

  return { isDismissed: storedDismissed || dismissedKey === storageKey, dismiss };
}

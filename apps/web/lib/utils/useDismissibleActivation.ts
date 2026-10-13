"use client";

import { useCallback, useEffect, useState } from "react";

const DEFAULT_DISMISSAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

export function useDismissibleActivation(key: string, durationMs = DEFAULT_DISMISSAL_DURATION_MS) {
  const storageKey = `wm:${key}:dismissedUntil`;
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    let rawValue: string | null = null;

    try {
      rawValue = window.localStorage.getItem(storageKey);
    } catch {
      setIsDismissed(false);
      return;
    }

    if (!rawValue) {
      setIsDismissed(false);
      return;
    }

    const dismissedUntil = Number(rawValue);

    if (!Number.isFinite(dismissedUntil) || dismissedUntil <= Date.now()) {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // Ignore blocked storage and fall back to not dismissed.
      }
      setIsDismissed(false);
      return;
    }

    setIsDismissed(true);
  }, [storageKey]);

  const dismiss = useCallback(() => {
    const dismissedUntil = Date.now() + durationMs;
    try {
      window.localStorage.setItem(storageKey, String(dismissedUntil));
    } catch {
      // Ignore blocked storage and still dismiss locally.
    }
    setIsDismissed(true);
  }, [durationMs, storageKey]);

  return { isDismissed, dismiss };
}

"use client";

import * as React from "react";

import {
  getRateLimitInfo,
  getSecondsRemaining,
  type RateLimitInfo,
} from "@/lib/api/rate-limit";
import { rateLimitCoordinator } from "@/lib/api/rate-limit-coordinator";

export type RateLimitRetryState = {
  /** Shared end of the window; every widget shows the same number. */
  resumeAt: number | null;
  /** Whole seconds left, ticking once per second, floored at 0. */
  secondsRemaining: number;
  /** True once the window has elapsed and the retry has been handed over. */
  isResuming: boolean;
};

/**
 * Registers a rate-limited widget with the tab-wide coordinator, exposes the
 * shared countdown, and fires `onRetry` once at this widget's staggered slot.
 *
 * The retry fires exactly once per registration. If the retry is throttled
 * again, the new error produces a new registration and a new window — which is
 * how a persistent limit degrades into repeated waiting rather than a loop.
 */
export function useRateLimitRetry(
  error: unknown,
  {
    onRetry,
    autoRetry = true,
  }: { onRetry?: () => void; autoRetry?: boolean } = {},
): RateLimitRetryState {
  const info: RateLimitInfo | null = React.useMemo(
    () => getRateLimitInfo(error),
    [error],
  );

  const [resumeAt, setResumeAt] = React.useState<number | null>(null);
  const [secondsRemaining, setSecondsRemaining] = React.useState(
    info?.retryAfterSeconds ?? 0,
  );
  const [isResuming, setIsResuming] = React.useState(false);

  // Kept in a ref so a new inline `onRetry` closure on every render does not
  // cancel and reschedule the pending retry, which would push it out forever.
  const onRetryRef = React.useRef(onRetry);
  React.useEffect(() => {
    onRetryRef.current = onRetry;
  }, [onRetry]);

  // Registering with the coordinator is an external side effect, and the
  // window it hands back is only known after registering, so this effect
  // publishes it (and resets when the error clears) deliberately.
  React.useEffect(() => {
    if (!info) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setResumeAt(null);
      setSecondsRemaining(0);
      setIsResuming(false);
      return;
    }

    const registration = rateLimitCoordinator.register(info);
    setResumeAt(registration.resumeAt);
    setSecondsRemaining(getSecondsRemaining(registration.resumeAt));
    setIsResuming(false);

    const tick = window.setInterval(() => {
      setSecondsRemaining(getSecondsRemaining(registration.resumeAt));
    }, 1000);

    let retryTimer: number | undefined;
    if (autoRetry) {
      retryTimer = window.setTimeout(
        () => {
          setIsResuming(true);
          onRetryRef.current?.();
        },
        Math.max(0, registration.retryAt - Date.now()),
      );
    }

    return () => {
      window.clearInterval(tick);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
    // `info` is memoised on the error identity; re-registering on every render
    // would keep moving the window.
  }, [info, autoRetry]);

  return { resumeAt, secondsRemaining, isResuming };
}

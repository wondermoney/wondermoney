/**
 * One shared rate-limit window for the whole tab.
 *
 * A page like the dashboard or reports fans out into six or more requests at
 * once. When the limiter trips, all of them get a 429 within milliseconds of
 * each other — and if each one independently waited exactly `Retry-After` and
 * then fired, they would arrive together and trip the limiter again. That is
 * the stampede this module exists to prevent.
 *
 * Two things follow from that:
 *
 *   1. **One countdown.** Every waiter shares a single `resumeAt`, taken as the
 *      furthest window any of them was told to wait. The user sees one number
 *      counting down, not six disagreeing ones.
 *   2. **Staggered resume.** Each waiter is handed its own `retryAt`, spread
 *      `RATE_LIMIT_STAGGER_MS` apart with up to `RATE_LIMIT_JITTER_MS` of
 *      jitter on top, so the requests trickle rather than burst. The jitter
 *      also de-synchronises two tabs that were throttled by the same window.
 *
 * The visible countdown always tracks `resumeAt`; the stagger is deliberately
 * invisible, because "retrying in 30s" that actually fires at 30.4s is honest
 * and "retrying in 31s" for the second widget is just noise.
 */

import type { RateLimitInfo } from "./rate-limit";

/** Gap between consecutive waiters resuming. */
export const RATE_LIMIT_STAGGER_MS = 250;

/** Random spread added per waiter, on top of its stagger slot. */
export const RATE_LIMIT_JITTER_MS = 750;

export type RateLimitSnapshot = {
  active: boolean;
  /** Epoch ms the shared window is expected to clear, or `null` when idle. */
  resumeAt: number | null;
  /** Seconds between registration and `resumeAt`; 0 when idle. */
  retryAfterSeconds: number;
  /** How many callers are waiting on the current window. */
  waiterCount: number;
};

export type RateLimitRegistration = {
  /** Shared, user-visible end of the window. */
  resumeAt: number;
  /** This caller's own staggered moment to actually retry. */
  retryAt: number;
};

const IDLE_SNAPSHOT: RateLimitSnapshot = {
  active: false,
  resumeAt: null,
  retryAfterSeconds: 0,
  waiterCount: 0,
};

export type RateLimitCoordinator = {
  register: (info: RateLimitInfo) => RateLimitRegistration;
  /** Delay in ms for a React Query `retryDelay`, honouring `Retry-After`. */
  getRetryDelayMs: (info: RateLimitInfo) => number;
  /** A successful response means the window is over; drop it. */
  noteRecovered: () => void;
  getSnapshot: () => RateLimitSnapshot;
  subscribe: (listener: () => void) => () => void;
  reset: () => void;
};

export function createRateLimitCoordinator({
  now = () => Date.now(),
  random = Math.random,
}: {
  now?: () => number;
  random?: () => number;
} = {}): RateLimitCoordinator {
  let snapshot: RateLimitSnapshot = IDLE_SNAPSHOT;
  let nextSlot = 0;
  const listeners = new Set<() => void>();

  function emit() {
    for (const listener of listeners) listener();
  }

  function isWindowOpen(at: number): boolean {
    return (
      snapshot.active && snapshot.resumeAt !== null && snapshot.resumeAt > at
    );
  }

  function register(info: RateLimitInfo): RateLimitRegistration {
    const nowMs = now();
    const open = isWindowOpen(nowMs);

    // Take the furthest window anyone was given. A limiter family with a
    // longer cooldown must not be retried early just because a cheaper one
    // said 5 seconds.
    const resumeAt = open
      ? Math.max(snapshot.resumeAt as number, nowMs + info.retryAfterMs)
      : nowMs + info.retryAfterMs;

    if (!open) nextSlot = 0;
    const slot = nextSlot++;

    const retryAt =
      resumeAt + slot * RATE_LIMIT_STAGGER_MS + random() * RATE_LIMIT_JITTER_MS;

    snapshot = {
      active: true,
      resumeAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resumeAt - nowMs) / 1000)),
      waiterCount: slot + 1,
    };
    emit();

    return { resumeAt, retryAt };
  }

  function getRetryDelayMs(info: RateLimitInfo): number {
    const { retryAt } = register(info);
    return Math.max(0, Math.round(retryAt - now()));
  }

  function noteRecovered() {
    if (!snapshot.active) return;

    snapshot = IDLE_SNAPSHOT;
    nextSlot = 0;
    emit();
  }

  function getSnapshot(): RateLimitSnapshot {
    // Lazily expire so a stale window does not keep a calm state on screen
    // forever. Returning the shared IDLE reference keeps this safe for
    // `useSyncExternalStore`, which compares snapshots by identity.
    if (snapshot.active && !isWindowOpen(now())) {
      snapshot = IDLE_SNAPSHOT;
      nextSlot = 0;
    }

    return snapshot;
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function reset() {
    snapshot = IDLE_SNAPSHOT;
    nextSlot = 0;
    listeners.clear();
  }

  return {
    register,
    getRetryDelayMs,
    noteRecovered,
    getSnapshot,
    subscribe,
    reset,
  };
}

/** The tab-wide instance. Tests build their own with `createRateLimitCoordinator`. */
export const rateLimitCoordinator = createRateLimitCoordinator();

/**
 * The shared React Query retry policy.
 *
 * Split out of `query-client.ts` so it can be tested without dragging in
 * PostHog and `window`.
 */

import { getRateLimitInfo } from "@/lib/api/rate-limit";
import {
  type RateLimitCoordinator,
  rateLimitCoordinator as defaultCoordinator,
} from "@/lib/api/rate-limit-coordinator";
import { getErrorStatusCode } from "@/lib/errors/app-error";

export const DEFAULT_QUERY_RETRIES = 2;
export const MAX_QUERY_RETRY_DELAY_MS = 30_000;

/**
 * A 429 is not retried behind the user's back.
 *
 * React Query's own retry would hide the wait behind a spinner: the query stays
 * `pending` for the whole `Retry-After` window — up to five minutes — with no
 * indication that waiting is the fix. Letting it settle into an error state
 * immediately is what makes the calm "too many requests, retrying in Ns" state
 * renderable, and the resume is then owned by `useRateLimitRetry`, which fires
 * on a coordinator-staggered schedule instead of all at once.
 */
export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (getErrorStatusCode(error) === 401) return false;
  if (getRateLimitInfo(error) !== null) return false;

  return failureCount < DEFAULT_QUERY_RETRIES;
}

/**
 * Delay before React Query's next attempt.
 *
 * Rate-limit errors are not retried by the policy above, but a caller may opt a
 * specific query back in (`retry: 1`), so the delay still honours `Retry-After`
 * through the coordinator rather than falling back to a fixed backoff.
 */
export function getQueryRetryDelayMs(
  failureCount: number,
  error: unknown,
  coordinator: RateLimitCoordinator = defaultCoordinator,
): number {
  const rateLimit = getRateLimitInfo(error);
  if (rateLimit) return coordinator.getRetryDelayMs(rateLimit);

  return Math.min(1000 * 2 ** failureCount, MAX_QUERY_RETRY_DELAY_MS);
}

import { env } from "@/lib/utils/env";

/**
 * Phase 0 kill-switch for the GoCardless → Enable Banking migration: the shared
 * GoCardless credential is being cancelled, so bank-connect entry points render as
 * paused (non-interactive, with an explanation + FAQ link) instead of attempting a
 * connection that would fail against a dead provider.
 */
export function isBankConnectionsPaused() {
  return env.NEXT_PUBLIC_BANK_CONNECTIONS_PAUSED === "1";
}

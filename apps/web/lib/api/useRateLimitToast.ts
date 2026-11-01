"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { toast } from "sonner";

import { getRateLimitInfo } from "@/lib/api/rate-limit";
import { rateLimitCoordinator } from "@/lib/api/rate-limit-coordinator";

/**
 * The mutation half of the 429 story.
 *
 * Reads get a calm, recoverable state from the query layer, which detects the
 * 429 and renders "too many requests, retrying in Ns" with a staggered resume.
 * Without this, a throttled POST/PATCH/DELETE would fall through to whatever
 * generic "something went wrong" toast the call site happens to have — for the
 * one outcome that is neither the user's fault nor a failure.
 *
 * A mutation is not auto-retried (replaying a write is not safe in general), so
 * the copy says when the action is *available* again rather than promising a
 * retry. The window still goes through the shared coordinator, so a throttled
 * write and a throttled read agree about when the pause ends.
 *
 * Concurrent failures collapse onto one toast id: a table that fires six
 * mutations at once should say "wait a moment" once, not six times.
 */
const RATE_LIMIT_TOAST_ID = "rate-limited-mutation";

export function useRateLimitToast() {
  const t = useTranslations();

  /**
   * Shows the calm state and returns `true` when `error` was a 429, so a caller
   * can `return` before its generic error toast. Returns `false` for everything
   * else, leaving normal error handling untouched.
   */
  return useCallback(
    (error: unknown): boolean => {
      const info = getRateLimitInfo(error);
      if (!info) return false;

      const { resumeAt } = rateLimitCoordinator.register(info);
      const seconds = Math.max(
        0,
        Math.ceil((resumeAt - Date.now()) / 1000),
      );

      toast.error(t("rate-limited-title"), {
        description:
          seconds > 0
            ? t("rate-limited-available-in", { seconds })
            : t("rate-limited-available-now"),
        id: RATE_LIMIT_TOAST_ID,
      });

      return true;
    },
    [t],
  );
}


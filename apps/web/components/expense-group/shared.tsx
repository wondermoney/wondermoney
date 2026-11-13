"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  isDemoReadOnlyError,
  isHouseholdReadOnlyError,
} from "@/lib/api/errors";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import { expenseGroupErrorKey } from "@/lib/expense-group/expense-group";

/** A native select styled like the app's inputs (the template dialog uses the same). */
export const selectClassName =
  "border-input bg-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

/** Enter in a field of an inline form must not submit the edit sheet's form around it. */
export const keepEnterInside = (
  event: React.KeyboardEvent<HTMLElement>,
  onEnter?: () => void,
) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  onEnter?.();
};

/**
 * The words for a refused group write: the API's reason when it has one this client knows, else
 * `fallback`. Null when the refusal is already explained elsewhere: a 429, the demo, or a
 * viewer's read-only write (`HouseholdReadOnlyNotifier` says why, once).
 */
export function useGroupErrorMessage() {
  const t = useTranslations("expenseGroups.errors");
  const tRoot = useTranslations();
  const notifyIfRateLimited = useRateLimitToast();
  return (
    error: unknown,
    fallback: "save" | "load" = "save",
  ): string | null => {
    if (notifyIfRateLimited(error)) return null;
    if (isHouseholdReadOnlyError(error)) return null;
    if (isDemoReadOnlyError(error)) {
      toast.error(tRoot("demo-read-only-title"), {
        description: tRoot("demo-read-only-description"),
      });
      return null;
    }
    const key = expenseGroupErrorKey(error);
    return t(key ?? fallback);
  };
}

/** A refused write as a toast, unless it is explained elsewhere. */
export function useGroupErrorToast() {
  const message = useGroupErrorMessage();
  return (error: unknown) => {
    const text = message(error);
    if (text) toast.error(text, { duration: 9000 });
  };
}

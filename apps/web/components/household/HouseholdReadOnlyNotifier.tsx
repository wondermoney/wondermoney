"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";

import { isHouseholdReadOnlyError } from "@/lib/api/errors";

/** One toast however many writes a viewer's screen fires at once. */
const READ_ONLY_TOAST_ID = "household-read-only";

/**
 * A viewer can read the household's shared data but every write on it answers
 * 403 `household_read_only`. Screens are not gated per role, so this says why,
 * once, for any mutation that fails that way.
 */
export function HouseholdReadOnlyNotifier() {
  const queryClient = useQueryClient();
  const t = useTranslations("household");

  useEffect(
    () =>
      queryClient.getMutationCache().subscribe((event) => {
        if (event.type !== "updated" || event.action.type !== "error") return;
        if (!isHouseholdReadOnlyError(event.action.error)) return;
        toast.error(t("readOnly.title"), {
          description: t("readOnly.description"),
          id: READ_ONLY_TOAST_ID,
        });
      }),
    [queryClient, t],
  );

  return null;
}

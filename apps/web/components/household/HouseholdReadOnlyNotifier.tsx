"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";

import { accountAccessErrorKey } from "@/lib/account/access-error-messages";
import { isHouseholdReadOnlyError } from "@/lib/api/errors";

/** One toast however many writes a viewer's screen fires at once. */
const READ_ONLY_TOAST_ID = "household-read-only";
const ACCOUNT_ACCESS_TOAST_ID = "account-access";

/**
 * A viewer can read the household's shared data but every write on it answers
 * 403 `household_read_only`; a member an account was shared with to view gets
 * `account_read_only` on a write to it, and changing who can see an account
 * without being allowed to answers `account_share_manager_required`. Screens
 * hide what they can, so this says why, once, for any mutation that still
 * fails that way.
 */
export function HouseholdReadOnlyNotifier() {
  const queryClient = useQueryClient();
  const t = useTranslations();

  useEffect(
    () =>
      queryClient.getMutationCache().subscribe((event) => {
        if (event.type !== "updated" || event.action.type !== "error") return;
        const error = event.action.error;
        if (isHouseholdReadOnlyError(error)) {
          toast.error(t("household.readOnly.title"), {
            description: t("household.readOnly.description"),
            id: READ_ONLY_TOAST_ID,
          });
          return;
        }
        const accountKey = accountAccessErrorKey(error);
        if (accountKey === "account_read_only") {
          toast.error(t("accountSharing.view-only"), {
            description: t("accountSharing.errors.account_read_only"),
            id: ACCOUNT_ACCESS_TOAST_ID,
          });
        } else if (accountKey) {
          toast.error(t(`accountSharing.errors.${accountKey}`), {
            id: ACCOUNT_ACCESS_TOAST_ID,
          });
        }
      }),
    [queryClient, t],
  );

  return null;
}

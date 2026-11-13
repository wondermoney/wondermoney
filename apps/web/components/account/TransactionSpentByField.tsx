"use client";

import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Label } from "@/components/ui/Label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { canEditAccount } from "@/lib/account/account-access";
import useAccounts from "@/lib/api/account/useAccounts";
import useSetTransactionAttribution, {
  type AttributedAppuserKey,
} from "@/lib/api/account/useSetTransactionAttribution";
import type {
  Transaction,
  TransactionAttribution,
} from "@/lib/api/account/useTransactions";
import { isDemoReadOnlyError, isHouseholdReadOnlyError } from "@/lib/api/errors";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import {
  memberDisplayName,
  SHARED_MEMBER,
} from "@/lib/household/member-attribution";
import { useHouseholdMembers } from "@/lib/household/useHouseholdMembers";

/** The option that hands the row back to its account. */
const ACCOUNT_DEFAULT = "default";

const optionOf = (attribution: TransactionAttribution | undefined): string => {
  if (!attribution?.overridden) return ACCOUNT_DEFAULT;
  return attribution.appuserKey === null
    ? SHARED_MEMBER
    : String(attribution.appuserKey);
};

const keyOf = (option: string): AttributedAppuserKey => {
  if (option === ACCOUNT_DEFAULT) return null;
  if (option === SHARED_MEMBER) return SHARED_MEMBER;
  return Number(option);
};

/**
 * "Spent by": whose spending the transaction counts as in reports, budgets and the member
 * filter. It follows its account (the owner, or Shared for a joint account) until someone picks a
 * member or Shared here. Saves at once, like the reimbursement field beside it.
 *
 * Renders nothing for a household of one, or on an account the caller can only view (its row has
 * no edit actions either). A household viewer's write answers `household_read_only`, which
 * `HouseholdReadOnlyNotifier` explains.
 */
export function TransactionSpentByField({
  transaction,
  disabled = false,
}: {
  transaction: Transaction;
  disabled?: boolean;
}) {
  const t = useTranslations("household.attribution");
  const tRoot = useTranslations();
  const id = useId();
  const posthog = usePostHog();
  const notifyIfRateLimited = useRateLimitToast();
  const { members } = useHouseholdMembers();
  const accountKey = transaction.accountKey.accountKey;
  const { data: account } = useAccounts({
    select: (data) =>
      data.accounts.find((candidate) => candidate.accountKey === accountKey),
    enabled: members.length > 1,
  });
  const setAttribution = useSetTransactionAttribution();
  const [attribution, setLocalAttribution] = useState(transaction.attribution);

  // Nobody to tell apart, or a row on an account shared to view only: shown, never changed.
  if (members.length <= 1 || !canEditAccount(account)) return null;

  // Who the account would give it to: the account says; a row that follows it says too.
  const accountDefault =
    account?.attribution ??
    (attribution && !attribution.overridden ? attribution : undefined);
  const defaultLabel = !accountDefault
    ? t("accountDefaultPlain")
    : t("accountDefault", {
        name:
          accountDefault.appuserKey === null
            ? t("shared")
            : (accountDefault.displayName ?? t("shared")),
      });

  const onChange = async (option: string) => {
    if (option === optionOf(attribution)) return;
    try {
      const { transaction: saved } = await setAttribution.mutateAsync({
        transactionKey: transaction.transactionKey,
        attributedAppuserKey: keyOf(option),
      });
      setLocalAttribution(saved.attribution);
      posthog.capture("transaction_edited", { field: "attribution" });
      toast.success(t("spentBySaved"));
    } catch (error) {
      if (notifyIfRateLimited(error) || isHouseholdReadOnlyError(error)) return;
      if (isDemoReadOnlyError(error)) {
        toast.error(tRoot("demo-read-only-title"), {
          description: tRoot("demo-read-only-description"),
        });
        return;
      }
      toast.error(t("spentByError"));
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t("spentBy")}</Label>
      <Select
        value={optionOf(attribution)}
        onValueChange={(option) => void onChange(option)}
        disabled={disabled || setAttribution.isPending}
      >
        <SelectTrigger id={id} aria-describedby={`${id}-description`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ACCOUNT_DEFAULT}>{defaultLabel}</SelectItem>
          {members.map((member) => (
            <SelectItem key={member.appuserKey} value={String(member.appuserKey)}>
              {memberDisplayName(member)}
            </SelectItem>
          ))}
          <SelectItem value={SHARED_MEMBER}>{t("shared")}</SelectItem>
        </SelectContent>
      </Select>
      <p id={`${id}-description`} className="text-muted-foreground text-xs">
        {t("spentByDescription")}
      </p>
    </div>
  );
}

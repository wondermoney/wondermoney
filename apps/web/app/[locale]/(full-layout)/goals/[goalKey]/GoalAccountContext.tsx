"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/components/ui/Link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import useAccounts from "@/lib/api/account/useAccounts";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import type { Goal } from "@/lib/api/goals/types";
import useAssignGoalAccount from "@/lib/api/goals/useAssignGoalAccount";
import useRemoveGoalAccount from "@/lib/api/goals/useRemoveGoalAccount";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";

function getAccountLabel(
  accountLink: NonNullable<Goal["accountLinks"]>[number],
) {
  return typeof accountLink.accountKey === "object"
    ? (accountLink.accountKey.accountName ?? null)
    : null;
}

export default function GoalAccountContext({ goal }: { goal: Goal }) {
  const t = useTranslations();
  const notifyIfRateLimited = useRateLimitToast();
  const [selectedAccountKey, setSelectedAccountKey] = useState("");
  const linkHintId = useId();
  const selectTriggerRef = useRef<HTMLButtonElement>(null);
  const { data } = useAccounts();
  const assignAccount = useAssignGoalAccount(goal.goalKey);
  const removeAccount = useRemoveGoalAccount(goal.goalKey);
  const accountLinks = goal.accountLinks ?? [];
  const linkedKeys = new Set(
    accountLinks.map((link) =>
      typeof link.accountKey === "object"
        ? link.accountKey.accountKey
        : link.accountKey,
    ),
  );
  const availableAccounts =
    data?.accounts.filter((account) => !linkedKeys.has(account.accountKey)) ??
    [];
  const canLink = selectedAccountKey !== "";

  const showMutationError = (error: unknown) => {
    if (notifyIfRateLimited(error)) return;
    if (isDemoReadOnlyError(error)) {
      toast.error(t("demo-read-only-title"), {
        description: t("demo-read-only-description"),
      });
      return;
    }
    toast.error(t("goals.account-link-error"));
  };

  const linkAccount = async () => {
    const accountKey = Number(selectedAccountKey);
    if (!Number.isInteger(accountKey) || accountKey <= 0) {
      // The button is `aria-disabled`, not `disabled`, so it is still
      // focusable and still receives the click. Sending focus to the picker
      // makes the dead click do the one thing that unblocks it, instead of
      // nothing.
      selectTriggerRef.current?.focus();
      return;
    }
    try {
      await assignAccount.mutateAsync({ accountKey });
      setSelectedAccountKey("");
      toast.success(t("goals.account-linked"));
    } catch (error) {
      showMutationError(error);
    }
  };

  const unlinkAccount = async (accountKey: number) => {
    try {
      await removeAccount.mutateAsync({ accountKey });
      toast.success(t("goals.account-unlinked"));
    } catch (error) {
      showMutationError(error);
    }
  };

  return (
    <Card className="space-y-4 p-6">
      <h2 className="text-foreground text-sm font-semibold">
        {t("goals.linked-account")}
      </h2>
      <p className="text-muted-foreground text-sm">
        {t("goals.account-context-note")}
      </p>
      {accountLinks.map((account) => {
        const key =
          typeof account.accountKey === "object"
            ? account.accountKey.accountKey
            : account.accountKey;
        return (
          <div
            key={account.goalAccountLinkKey ?? key}
            className="flex items-center justify-between gap-3 rounded-md border p-3"
          >
            <span className="text-foreground text-sm">
              {getAccountLabel(account) ?? t("goals.linked-account")}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={removeAccount.isPending}
              onClick={() => unlinkAccount(key)}
            >
              {t("goals.unlink-account")}
            </Button>
          </div>
        );
      })}
      {availableAccounts.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              value={selectedAccountKey}
              onValueChange={setSelectedAccountKey}
            >
              <SelectTrigger ref={selectTriggerRef} className="w-full">
                <SelectValue
                  placeholder={t("goals.link-account-placeholder")}
                />
              </SelectTrigger>
              <SelectContent>
                {availableAccounts.map((account) => (
                  <SelectItem
                    key={account.accountKey}
                    value={String(account.accountKey)}
                  >
                    {account.accountName ?? t("unknown")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/*
              This was `variant="outline"` with a real `disabled` attribute, and
              it read as an ordinary secondary action: violet text on the canvas
              at 50%, indistinguishable from a live tertiary button, so the
              first click did nothing and said nothing.
              Three changes, none of which lean on colour or opacity alone:
              - `default` instead of `outline`. The link is *the* action of this
                card (the unlink buttons are `ghost`), so the live state is a
                filled violet button and the unavailable state is a washed-out
                solid block — two shapes you cannot confuse, rather than two
                weights of the same tinted text.
              - `aria-disabled` instead of `disabled`. A `disabled` button is
                dropped from the tab order and its description is never read,
                so the reason was unreachable non-visually. `aria-disabled`
                keeps it focusable and announced as unavailable, with
                `aria-describedby` carrying the why.
              - the reason is stated in visible text below, not implied.
              `disabled:` utilities key off the `:disabled` pseudo-class, which
              no longer matches, so the state contract's opacity, suppressed
              hover and suppressed press are restated on `aria-disabled:`.
              `loading` still sets the real `disabled` + `aria-busy` while the
              mutation is in flight — busy and blocked are different states.
            */}
            <Button
              type="button"
              aria-disabled={!canLink}
              aria-describedby={canLink ? undefined : linkHintId}
              loading={assignAccount.isPending}
              onClick={linkAccount}
              className="aria-disabled:hover:bg-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:active:scale-100"
            >
              {t("goals.link-account")}
            </Button>
          </div>
          {canLink ? null : (
            <p
              id={linkHintId}
              className="text-muted-foreground flex items-center gap-1.5 text-sm"
            >
              <Info aria-hidden="true" className="size-3.5 shrink-0" />
              {t("goals.link-account-disabled-hint")}
            </p>
          )}
        </div>
      ) : accountLinks.length === 0 ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">
            {t("goals.no-accounts-to-link")}
          </p>
          <Button asChild size="sm" variant="outline">
            <Link href="/accounts">{t("add-account")}</Link>
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

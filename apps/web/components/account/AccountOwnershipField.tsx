"use client";

import { useFormatter, useTranslations } from "next-intl";

import {
  ownershipMembers,
  ownershipRequest,
  type OwnershipState,
  ownershipTotal,
} from "@/lib/account/account-ownership";
import type {
  AccountOwnershipMember,
  AccountOwnershipResponse,
} from "@/lib/api/account/useAccountOwnership";
import { cn } from "@/lib/utils";

import { Input } from "../ui/input";
import { Label } from "../ui/Label";
import { Spinner } from "../ui/Spinner";
import { Switch } from "../ui/switch";

/**
 * Who owns what share of the account, for each member's net worth: off, the account counts for
 * its owner (or as Shared when joint); on, one percentage per member who can see it, adding up to
 * 100%. Spending reports are not split. Editable only for the account owner or the household owner
 * (`canManage`); anyone else sees the shares without the controls.
 */
export function AccountOwnershipField({
  ownership,
  isLoading,
  isError,
  state,
  onChange,
  disabled,
}: {
  ownership: AccountOwnershipResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  /** The control's state; null until `ownership` has loaded. */
  state: OwnershipState | null;
  onChange: (state: OwnershipState) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("accountOwnership");
  const format = useFormatter();
  const percent = (value: number) =>
    format.number(value / 100, { maximumFractionDigits: 2, style: "percent" });

  const memberName = (member: AccountOwnershipMember) =>
    [member.firstName, member.lastName]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ") || member.displayName;

  const body = () => {
    if (isLoading) {
      return (
        <div className="flex h-16 items-center justify-center">
          <Spinner size="small" />
        </div>
      );
    }
    if (isError || !ownership || !state) {
      return <p className="text-muted-foreground text-sm">{t("load-error")}</p>;
    }

    const members = ownershipMembers(ownership.members);
    const owner = ownership.members.find((member) => member.isAccountOwner);
    const formerMembers =
      ownership.formerMembersPercent > 0 ? (
        <p className="text-muted-foreground text-xs">
          {t("former-members", {
            percent: percent(ownership.formerMembersPercent),
          })}
        </p>
      ) : null;

    if (!ownership.canManage) {
      return (
        <div className="flex flex-col gap-3">
          {ownership.isSplit ? (
            <ul className="divide-border divide-y">
              {ownership.members
                .filter((member) => member.percent > 0)
                .map((member) => (
                  <li
                    key={member.appuserKey}
                    className="flex min-h-11 items-center justify-between gap-4 py-2 text-sm"
                  >
                    <span className="text-foreground truncate font-medium">
                      {memberName(member)}
                    </span>
                    <span className="text-foreground shrink-0 font-mono">
                      {percent(member.percent)}
                    </span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-foreground text-sm">
              {ownership.isJoint
                ? t("not-split-joint")
                : t("not-split", { name: owner ? memberName(owner) : "" })}
            </p>
          )}
          {formerMembers}
          <p className="text-muted-foreground text-xs">{t("manager-only")}</p>
        </div>
      );
    }

    const editable = !disabled;
    const total = ownershipTotal(ownership.members, state);
    const check = ownershipRequest(ownership.members, state);

    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="account-ownership-split">{t("split")}</Label>
            <p className="text-muted-foreground text-xs">
              {ownership.isJoint
                ? t("split-description-joint")
                : t("split-description")}
            </p>
          </div>
          <Switch
            id="account-ownership-split"
            checked={state.split}
            disabled={!editable}
            onCheckedChange={(split) => onChange({ ...state, split })}
          />
        </div>
        {state.split ? (
          <>
            <ul className="divide-border divide-y">
              {members.map((member) => {
                const name = memberName(member);
                const inputId = `account-ownership-${member.appuserKey}`;
                return (
                  <li
                    key={member.appuserKey}
                    className="flex min-h-14 items-center justify-between gap-4 py-2"
                  >
                    <label
                      htmlFor={inputId}
                      className="text-foreground min-w-0 truncate text-sm font-medium"
                    >
                      {name}
                    </label>
                    <div className="flex shrink-0 items-center gap-2">
                      <Input
                        id={inputId}
                        aria-label={t("percent-label", { name })}
                        className="h-11 w-24 text-right font-mono sm:h-10"
                        disabled={!editable}
                        inputMode="decimal"
                        value={state.percents[member.appuserKey] ?? ""}
                        onChange={(event) =>
                          onChange({
                            ...state,
                            percents: {
                              ...state.percents,
                              [member.appuserKey]: event.target.value,
                            },
                          })
                        }
                      />
                      <span
                        aria-hidden
                        className="text-muted-foreground text-sm"
                      >
                        %
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p
              role="status"
              className={cn(
                "text-xs",
                check.ok ? "text-muted-foreground" : "text-destructive-text",
              )}
            >
              {check.ok || check.error === "total"
                ? t("total", { total: percent(total / 100) })
                : t("invalid")}
            </p>
          </>
        ) : null}
        {formerMembers}
      </div>
    );
  };

  return (
    <section
      aria-labelledby="account-ownership-heading"
      className="border-border mt-8 border-t pt-6"
    >
      <div className="mb-3 space-y-1">
        <h3
          id="account-ownership-heading"
          className="text-foreground text-sm font-medium"
        >
          {t("title")}
        </h3>
        <p className="text-muted-foreground text-xs">{t("description")}</p>
      </div>
      {body()}
    </section>
  );
}

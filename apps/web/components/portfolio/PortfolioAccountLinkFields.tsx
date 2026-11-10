"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import { Label } from "@/components/ui/Label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import type { Account } from "@/lib/api/account/useAccounts";
import {
  chooseLinkAccount,
  type PortfolioAccountBalanceMode,
  type PortfolioAccountLinkDraft,
  sortLinkableAccounts,
} from "@/lib/portfolio/account-link";

const NOT_LINKED = "none";

interface PortfolioAccountLinkFieldsProps {
  accounts: Account[];
  value: PortfolioAccountLinkDraft;
  onChange: (value: PortfolioAccountLinkDraft) => void;
  disabled?: boolean;
}

/**
 * Pick the account that holds a portfolio, then answer whether that account's balance already
 * includes the investments. The answer is always asked; choosing an account preselects "No, cash
 * only" for a bank-synced account and "Yes" for a manual one.
 */
export function PortfolioAccountLinkFields({
  accounts,
  value,
  onChange,
  disabled,
}: PortfolioAccountLinkFieldsProps) {
  const t = useTranslations("portfolioAccountLink");
  const id = useId();
  const sorted = sortLinkableAccounts(accounts);
  const modes: Array<{
    mode: PortfolioAccountBalanceMode;
    label: string;
    hint: string;
  }> = [
    {
      mode: "includes_holdings",
      label: t("includes-holdings"),
      hint: t("includes-holdings-hint"),
    },
    { mode: "cash_only", label: t("cash-only"), hint: t("cash-only-hint") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-account`}>{t("account-label")}</Label>
        <Select
          value={value.accountId === null ? NOT_LINKED : String(value.accountId)}
          onValueChange={(next) =>
            onChange(
              chooseLinkAccount(
                accounts,
                next === NOT_LINKED ? null : Number(next),
              ),
            )
          }
          disabled={disabled}
        >
          <SelectTrigger id={`${id}-account`} className="w-full">
            <SelectValue placeholder={t("select-account")} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={NOT_LINKED}>{t("not-linked")}</SelectItem>
              {sorted.map((account) => (
                <SelectItem
                  key={account.accountKey}
                  value={String(account.accountKey)}
                >
                  {account.accountName ??
                    account.accountFinancialInstitutionKey?.displayName ??
                    String(account.accountKey)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {value.accountId !== null ? (
        <fieldset className="flex flex-col gap-2" disabled={disabled}>
          <legend className="mb-2 text-sm font-medium">{t("question")}</legend>
          {modes.map((option) => (
            <label
              key={option.mode}
              className="border-border has-[:checked]:border-foreground flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 text-sm"
            >
              <input
                type="radio"
                name={`${id}-mode`}
                value={option.mode}
                checked={value.mode === option.mode}
                onChange={() => onChange({ ...value, mode: option.mode })}
                className="mt-0.5"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{option.label}</span>
                <span className="text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}

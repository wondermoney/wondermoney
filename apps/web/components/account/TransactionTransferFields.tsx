"use client";

import { useTranslations } from "next-intl";

import {
  decodeTransferDestination,
  encodeTransferDestination,
  type TransferDestination,
} from "@/lib/account/transaction-transfer";
import useAccounts from "@/lib/api/account/useAccounts";
import useGoals from "@/lib/api/goals/useGoals";
import usePortfolios from "@/lib/api/portfolio/usePortfolios";

import { Label } from "../ui/Label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../ui/Select";
import { Switch } from "../ui/switch";

type Props = {
  /** The row's account: never offered as its own destination. */
  accountKey: number;
  amount: number;
  destination: TransferDestination | null;
  disabled?: boolean;
  isTransfer: boolean;
  onDestinationChange: (destination: TransferDestination | null) => void;
  onTransferChange: (transfer: boolean) => void;
};

/**
 * "Mark as transfer" in the transaction editor: a transfer between the user's
 * own money is left out of spending and income. An outgoing transfer may say
 * where it went (another account, a portfolio or a goal).
 */
export function TransactionTransferFields({
  accountKey,
  amount,
  destination,
  disabled,
  isTransfer,
  onDestinationChange,
  onTransferChange,
}: Props) {
  const t = useTranslations();
  const outgoing = amount < 0;
  const loadDestinations = isTransfer && outgoing;

  const { data: accounts } = useAccounts({ enabled: loadDestinations });
  const { data: portfolios } = usePortfolios({ enabled: loadDestinations });
  const { data: goals } = useGoals(undefined, { enabled: loadDestinations });

  const accountOptions = (accounts?.accounts ?? []).filter(
    (account) => account.accountKey !== accountKey,
  );
  const portfolioOptions = portfolios?.portfolios ?? [];
  const goalOptions = (goals?.goals ?? []).filter(
    (goal) => goal.status === "active" || goal.status === "paused",
  );

  return (
    <div className="bg-muted space-y-3 rounded-md p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <Label htmlFor="mark-as-transfer" className="text-sm font-medium">
            {t("transferEdit.mark-as-transfer")}
          </Label>
          <p className="text-muted-foreground text-sm">
            {t("transferEdit.mark-as-transfer-description")}
          </p>
        </div>
        <Switch
          id="mark-as-transfer"
          checked={isTransfer}
          onCheckedChange={onTransferChange}
          disabled={disabled || amount === 0}
        />
      </div>
      {isTransfer && outgoing && (
        <div className="space-y-2">
          <Label htmlFor="transfer-destination">
            {t("transferEdit.destination")}
          </Label>
          <Select
            value={encodeTransferDestination(destination)}
            onValueChange={(value) =>
              onDestinationChange(decodeTransferDestination(value))
            }
            disabled={disabled}
          >
            <SelectTrigger id="transfer-destination">
              <SelectValue placeholder={t("transferEdit.destination-none")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {t("transferEdit.destination-none")}
              </SelectItem>
              {accountOptions.length > 0 && (
                <SelectGroup>
                  <SelectLabel>
                    {t("transferEdit.destination-accounts")}
                  </SelectLabel>
                  {accountOptions.map((account) => (
                    <SelectItem
                      key={`account:${account.accountKey}`}
                      value={encodeTransferDestination({
                        type: "account",
                        key: account.accountKey,
                      })}
                    >
                      {account.accountName ??
                        account.accountFinancialInstitutionKey?.displayName ??
                        t("transferEdit.destination-unnamed-account")}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {portfolioOptions.length > 0 && (
                <SelectGroup>
                  <SelectLabel>
                    {t("transferEdit.destination-portfolios")}
                  </SelectLabel>
                  {portfolioOptions.map((portfolio) => (
                    <SelectItem
                      key={`portfolio:${portfolio.portfolioKey}`}
                      value={encodeTransferDestination({
                        type: "portfolio",
                        key: portfolio.portfolioKey,
                      })}
                    >
                      {portfolio.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {goalOptions.length > 0 && (
                <SelectGroup>
                  <SelectLabel>
                    {t("transferEdit.destination-goals")}
                  </SelectLabel>
                  {goalOptions.map((goal) => (
                    <SelectItem
                      key={`goal:${goal.goalKey}`}
                      value={encodeTransferDestination({
                        type: "goal",
                        key: goal.goalKey,
                      })}
                    >
                      {goal.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

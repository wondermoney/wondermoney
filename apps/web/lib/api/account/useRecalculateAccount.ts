import { useMutation } from "@tanstack/react-query";

import api from "../api";

/**
 * `progress` of a finished `account.recalculate` background operation: how many
 * of the account's rows the rebuild corrected, and its balance before and after
 * (`balance*` in the account's currency, `appuserCurrencyBalance*` in the
 * owner's).
 */
export interface AccountRecalculationResult {
  accountKey: number;
  amountsReconverted: number;
  appuserCurrency: string | null;
  appuserCurrencyBalanceAfter: number | null;
  appuserCurrencyBalanceBefore: number | null;
  balanceAfter: number | null;
  balanceBefore: number | null;
  currency: string;
  rowsChanged: number;
  rowsScanned: number;
}

export function accountRecalculationResultOf(
  progress: Record<string, unknown> | null | undefined,
): AccountRecalculationResult | null {
  return progress &&
    typeof progress.rowsChanged === "number" &&
    typeof progress.rowsScanned === "number" &&
    typeof progress.currency === "string"
    ? (progress as unknown as AccountRecalculationResult)
    : null;
}

/**
 * Starts rebuilding an account's balances in the background and resolves to
 * the operation id to follow with `useBackgroundOperation`. Starting it again
 * while one is queued answers that one; the API answers 429
 * `account_recalculation_too_soon` within a minute of the last one.
 */
export function useRecalculateAccount() {
  return useMutation({
    mutationFn: async (accountKey: number) => {
      const { data } = await api.post<{ operationId: string }>(
        `/v1/account/${accountKey}/recalculate`,
      );
      return data.operationId;
    },
  });
}

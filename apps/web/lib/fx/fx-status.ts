/**
 * How an amount shown in the user's currency was converted, as the API says
 * on each transaction and account:
 *
 * - `exact`: same currency, or converted at a current rate.
 * - `provisional`: converted at the latest rate there is, which is old
 *   (`fxRateDate`). It is converted again when a newer rate arrives.
 * - `missing`: no rate exists, so there is no converted amount. Show the
 *   original amount; totals leave it out.
 */
export type FxStatus = "exact" | "missing" | "provisional";

/** The fields the API sends; absent on an older API. */
export interface FxFields {
  fxStatus?: FxStatus | null;
  /** `YYYY-MM-DD`, set when `fxStatus` is `provisional`. */
  fxRateDate?: string | null;
}

export type FxView =
  | { status: "exact" }
  | { status: "missing" }
  | { status: "provisional"; rateDate: string | null };

/**
 * Read one amount's conversion. A row with no status (written before the API
 * had one, or from an older API) is `missing` only when it has no converted
 * amount in a different currency; otherwise it reads as converted.
 */
export function fxViewOf(
  fields: FxFields,
  amount: {
    converted: number | null | undefined;
    fromCurrency: string | undefined;
    toCurrency: string | undefined;
  },
): FxView {
  if (amount.fromCurrency && amount.fromCurrency === amount.toCurrency) {
    return { status: "exact" };
  }
  if (fields.fxStatus === "missing") return { status: "missing" };
  if (fields.fxStatus === "provisional") {
    return { status: "provisional", rateDate: fields.fxRateDate ?? null };
  }
  if (!fields.fxStatus && amount.converted == null && amount.fromCurrency) {
    return { status: "missing" };
  }
  return { status: "exact" };
}

/** A transaction row's conversion, from its settlement into the user's currency. */
export function transactionFxView(
  transaction: FxFields & {
    appuserSettlementAmount: number | null | undefined;
    settlementCurrencyKey: { code: string };
    appuserCurrencyKey: { code: string };
  },
): FxView {
  return fxViewOf(transaction, {
    converted: transaction.appuserSettlementAmount,
    fromCurrency: transaction.settlementCurrencyKey.code,
    toCurrency: transaction.appuserCurrencyKey.code,
  });
}

/** An account balance's conversion, from the account's currency into its owner's. */
export function accountFxView(
  account: FxFields & {
    appuserCurrencyBalance: number | null | undefined;
    currencyKey: { code: string };
    accountOwnerAppuserKey: { currencyKey: { code: string } };
  },
): FxView {
  return fxViewOf(account, {
    converted: account.appuserCurrencyBalance,
    fromCurrency: account.currencyKey.code,
    toCurrency: account.accountOwnerAppuserKey.currencyKey.code,
  });
}

/**
 * Where a user adds an exchange rate by hand: the Currencies tab of Settings.
 * `from` and `date` prefill its form. Until that tab exists, Settings opens on
 * its first tab.
 */
export function exchangeRateSettingsHref(
  prefill: { from?: string; date?: string } = {},
): string {
  const params = new URLSearchParams({ tab: "currencies" });
  if (prefill.from) params.set("from", prefill.from);
  if (prefill.date) params.set("date", prefill.date);
  return `/settings?${params.toString()}`;
}

/** A `YYYY-MM-DD` rate date for reading, e.g. "3 Nov 2026". */
export function formatRateDate(rateDate: string, locale: string): string {
  const date = new Date(`${rateDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return rateDate;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

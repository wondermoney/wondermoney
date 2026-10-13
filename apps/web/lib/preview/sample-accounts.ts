/**
 * The one fictional account set used by every "here's what you'll get" preview.
 *
 * Home and Accounts each carried their own invented dataset, so the same session
 * showed a total balance of €15,250 on one screen and €10,430 on the next — two
 * different fictional people, one product (RAD-589). Every preview surface reads
 * from here so they cannot drift apart again.
 *
 * The institutions are the ones WonderMoney users actually connect (measured on
 * production 2026-08-23: Revolut, ActivoBank and BPI are all in the top six), so
 * the preview looks like the product rather than like a mockup. Every surface
 * that renders this must label it as a preview — it is illustrative, not the
 * viewer's money.
 */
export interface PreviewAccount {
  /** Signed: a credit card carries a negative balance, as it does in the real list. */
  balance: number;
  /** Two-letter chip used where a bank logo would need a network round-trip. */
  initials: string;
  institution: string;
  name: string;
}

export const PREVIEW_ACCOUNTS: readonly PreviewAccount[] = [
  { balance: 3280.5, initials: "BP", institution: "Banco BPI", name: "Main checking" },
  { balance: 8150, initials: "RE", institution: "Revolut", name: "Savings" },
  { balance: -1000.5, initials: "AB", institution: "ActivoBank", name: "Credit card" },
];

/** €10,430.00 — derived, never written down twice. */
export const PREVIEW_TOTAL_BALANCE = PREVIEW_ACCOUNTS.reduce(
  (total, account) => total + account.balance,
  0,
);

/**
 * Formats a preview amount the way the real ledger does — sign outside the
 * symbol, always two decimals. Deliberately fixed to `en-IE` rather than the
 * viewer's locale: these are illustrative euro figures, not the viewer's money,
 * and a locale-switched preview reads as though it were their data.
 */
export function formatPreviewAmount(value: number): string {
  const formatted = Math.abs(value).toLocaleString("en-IE", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
  return value < 0 ? `-€${formatted}` : `€${formatted}`;
}

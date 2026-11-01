import { routing } from "@/i18n/routing";

/**
 * The bank-connection round trip.
 *
 * The API's Enable Banking callback always sends the browser to one fixed URL,
 * `/settings?tab=bank-provider&enableBankingConnection=success|error`, so the
 * redirect can never be steered from the request. Where the user started
 * (onboarding, Accounts, a budget) is remembered here instead: the page that
 * opens the bank saves a marker in session storage, and the Settings landing
 * consumes it and routes back with the result in `?bankConnection=`.
 *
 * The marker is same-origin client storage, so it is treated as untrusted
 * input: only the pages this app itself saves are accepted, and they are
 * rebuilt from the matched parts rather than navigated to verbatim.
 */

const BANK_ACCOUNT_SYNC_RETURN_MARKER_KEY =
  "wondermoney.bankAccountSyncReturn";
const BANK_ACCOUNT_SYNC_RETURN_MARKER_TTL_MS = 30 * 60 * 1000;

/** Set by the API callback on the Settings landing URL. */
export const ENABLE_BANKING_CONNECTION_PARAM = "enableBankingConnection";
/** Set by the Settings landing on the page the user is sent back to. */
export const BANK_CONNECTION_RESULT_PARAM = "bankConnection";

export type BankConnectionResult = "success" | "error";

type AppLocale = (typeof routing.locales)[number];

export type BankConnectionReturnTarget =
  | { kind: "onboarding"; locale?: AppLocale }
  | { kind: "accounts"; locale?: AppLocale }
  | { kind: "budget"; pathname: string; locale?: AppLocale };

interface BankAccountSyncReturnMarker {
  createdAt: number;
  page: string;
}

// The three shapes the savers write: `accounts` (Accounts, Settings
// reconnect), `<locale>/onboarding/sync` (first run) and the budget layout's
// locale-less pathname, `/budgets/<id>/<year>[/<month>]`.
const RETURN_PAGE_PATTERN = new RegExp(
  `^/?(?:(${routing.locales.join("|")})/)?` +
    `(accounts|onboarding/sync|budgets/\\d+/\\d{4}(?:/\\d{1,2})?)$`,
);

export function parseBankConnectionResult(
  value: string | null | undefined,
): BankConnectionResult | null {
  return value === "success" || value === "error" ? value : null;
}

export function parseBankConnectionReturnPage(
  page: string,
): BankConnectionReturnTarget | null {
  const match = RETURN_PAGE_PATTERN.exec(page);
  if (!match) return null;

  const locale = match[1] as AppLocale | undefined;
  const path = match[2]!;
  const withLocale = locale ? { locale } : {};
  if (path === "accounts") return { kind: "accounts", ...withLocale };
  if (path === "onboarding/sync") return { kind: "onboarding", ...withLocale };
  return { kind: "budget", pathname: `/${path}`, ...withLocale };
}

/**
 * Where to send the user back to, locale-less (the `@/i18n/navigation` router
 * adds it). A failed connection in onboarding goes back to the account step,
 * where the user can pick a bank again; every other page shows the result
 * itself.
 */
export function bankConnectionReturnHref(
  target: BankConnectionReturnTarget,
  result: BankConnectionResult,
): string {
  const query = `?${BANK_CONNECTION_RESULT_PARAM}=${result}`;
  switch (target.kind) {
    case "onboarding":
      return `${result === "success" ? "/onboarding/sync" : "/onboarding/account"}${query}`;
    case "accounts":
      return `/accounts${query}`;
    case "budget":
      return `${target.pathname}${query}`;
  }
}

function readBankAccountSyncReturnMarker(): BankAccountSyncReturnMarker | null {
  if (typeof window === "undefined") return null;

  let rawMarker: string | null = null;
  try {
    rawMarker = window.sessionStorage.getItem(
      BANK_ACCOUNT_SYNC_RETURN_MARKER_KEY,
    );
  } catch {
    return null;
  }

  if (!rawMarker) return null;

  try {
    const marker = JSON.parse(rawMarker) as Partial<BankAccountSyncReturnMarker>;
    if (typeof marker.createdAt !== "number" || typeof marker.page !== "string") {
      return null;
    }
    return marker as BankAccountSyncReturnMarker;
  } catch {
    return null;
  }
}

export function saveBankAccountSyncReturnMarker(page: string) {
  if (typeof window === "undefined") return;

  const marker: BankAccountSyncReturnMarker = {
    createdAt: Date.now(),
    page,
  };

  try {
    window.sessionStorage.setItem(
      BANK_ACCOUNT_SYNC_RETURN_MARKER_KEY,
      JSON.stringify(marker),
    );
  } catch {
    // best-effort only
  }
}

/**
 * Reads and removes the marker. Returns the page to go back to when the marker
 * is fresh and names a page this app saves; anything else (expired, malformed,
 * an unknown or external path) is dropped.
 */
export function consumeBankConnectionReturnTarget(
  now = Date.now(),
): BankConnectionReturnTarget | null {
  const marker = readBankAccountSyncReturnMarker();
  clearBankAccountSyncReturnMarker();
  if (!marker) return null;

  const age = now - marker.createdAt;
  if (age < 0 || age > BANK_ACCOUNT_SYNC_RETURN_MARKER_TTL_MS) return null;

  return parseBankConnectionReturnPage(marker.page);
}

function clearBankAccountSyncReturnMarker() {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(BANK_ACCOUNT_SYNC_RETURN_MARKER_KEY);
  } catch {
    // best-effort only
  }
}

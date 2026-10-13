const BANK_ACCOUNT_SYNC_RETURN_MARKER_KEY =
  "wondermoney.bankAccountSyncReturn";
const BANK_ACCOUNT_SYNC_RETURN_MARKER_TTL_MS = 30 * 60 * 1000;

interface BankAccountSyncReturnMarker {
  createdAt: number;
  page: string;
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
      try {
        window.sessionStorage.removeItem(BANK_ACCOUNT_SYNC_RETURN_MARKER_KEY);
      } catch {
        // best-effort cleanup
      }
      return null;
    }

    return marker as BankAccountSyncReturnMarker;
  } catch {
    try {
      window.sessionStorage.removeItem(BANK_ACCOUNT_SYNC_RETURN_MARKER_KEY);
    } catch {
      // best-effort cleanup
    }
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

export function hasActiveBankAccountSyncReturnMarker(
  page: string,
  now = Date.now(),
) {
  const marker = readBankAccountSyncReturnMarker();
  if (!marker) return false;

  const isStale = now - marker.createdAt > BANK_ACCOUNT_SYNC_RETURN_MARKER_TTL_MS;
  const isWrongPage = marker.page !== page;

  if (isStale || isWrongPage) {
    clearBankAccountSyncReturnMarker();
    return false;
  }

  return true;
}

/** Uses the Task15 callback marker without inferring bank state from account data. */
export function hasActiveBankAccountSyncHandoff(now = Date.now()) {
  const marker = readBankAccountSyncReturnMarker();
  if (!marker) return false;

  if (now - marker.createdAt > BANK_ACCOUNT_SYNC_RETURN_MARKER_TTL_MS) {
    clearBankAccountSyncReturnMarker();
    return false;
  }

  return true;
}

export function clearBankAccountSyncReturnMarker() {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(BANK_ACCOUNT_SYNC_RETURN_MARKER_KEY);
  } catch {
    // best-effort only
  }
}

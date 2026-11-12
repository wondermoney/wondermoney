/**
 * The one-time "add a passkey" offer after a password sign-in.
 *
 * The login form marks the offer as pending in `sessionStorage` (it survives the full page
 * loads through the MFA challenge to the app, and dies with the tab); the app shell shows the
 * offer and drops the mark once it is answered or does not apply. Once the user adds a passkey
 * or says "Not now", `localStorage` remembers it for that account in this browser, so it is
 * never offered there again. Blocked storage means no offer, never an offer on every sign-in.
 */

const PENDING_KEY = "wm:passkey-offer:pending";
const doneKey = (userId: string) => `wm:passkey-offer:done:${userId}`;

/** Called by the login form after a successful password step. */
export function markPasskeyOfferPending(): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, "1");
  } catch {
    // Storage blocked: no offer this time.
  }
}

/** Whether a password sign-in in this tab is waiting for the offer. */
export function isPasskeyOfferPending(): boolean {
  try {
    return window.sessionStorage.getItem(PENDING_KEY) === "1";
  } catch {
    return false;
  }
}

/** Drop the mark: the offer was answered, or it does not apply to this account. */
export function clearPasskeyOfferPending(): void {
  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Storage blocked: there is no mark to drop.
  }
}

/** Whether this account already answered the offer in this browser. */
export function isPasskeyOfferDone(userId: string): boolean {
  try {
    return window.localStorage.getItem(doneKey(userId)) !== null;
  } catch {
    return true;
  }
}

export function markPasskeyOfferDone(userId: string): void {
  try {
    window.localStorage.setItem(doneKey(userId), new Date().toISOString());
  } catch {
    // Storage blocked: the offer is not shown without storage anyway.
  }
}

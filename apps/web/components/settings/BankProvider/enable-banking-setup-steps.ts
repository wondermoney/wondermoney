import { API_ERROR_CODE, getApiErrorCode } from "@/lib/api/errors";
import type { EnableBankingCredentialResponse } from "@/lib/api/user/useEnableBankingCredential";

/**
 * The Enable Banking setup wizard's steps, in order. The ids are stable: they are what the
 * browser remembers and what analytics (#698) will name, so rename a step's copy, never its id.
 */
export const ENABLE_BANKING_SETUP_STEP = {
  signIn: "sign_in",
  createApplication: "create_application",
  activate: "activate",
  applicationId: "application_id",
  done: "done",
} as const;

export type EnableBankingSetupStep =
  (typeof ENABLE_BANKING_SETUP_STEP)[keyof typeof ENABLE_BANKING_SETUP_STEP];

export const ENABLE_BANKING_SETUP_STEPS: readonly EnableBankingSetupStep[] = [
  ENABLE_BANKING_SETUP_STEP.signIn,
  ENABLE_BANKING_SETUP_STEP.createApplication,
  ENABLE_BANKING_SETUP_STEP.activate,
  ENABLE_BANKING_SETUP_STEP.applicationId,
  ENABLE_BANKING_SETUP_STEP.done,
];

/** The step's place, from 1, as the wizard shows it ("Step 2 of 5"). */
export function stepNumber(step: EnableBankingSetupStep): number {
  return ENABLE_BANKING_SETUP_STEPS.indexOf(step) + 1;
}

function isStep(value: unknown): value is EnableBankingSetupStep {
  return ENABLE_BANKING_SETUP_STEPS.includes(value as EnableBankingSetupStep);
}

/**
 * Where the wizard opens. The server's pending credential is the source of truth: a certificate
 * waiting for its application ID means the person is somewhere in steps 2 to 4, so the step this
 * browser remembers is used only inside that range; without one they cannot be past step 2,
 * because there is no certificate to register. The remembered step is a convenience: it is
 * missing in another browser, and wrong after the pending key lapsed.
 */
export function resolveResumeStep(
  credential: EnableBankingCredentialResponse | undefined,
  remembered: EnableBankingSetupStep | null,
): EnableBankingSetupStep {
  const pending = Boolean(credential?.pending);
  if (pending) {
    return remembered === ENABLE_BANKING_SETUP_STEP.activate ||
      remembered === ENABLE_BANKING_SETUP_STEP.applicationId
      ? remembered
      : ENABLE_BANKING_SETUP_STEP.createApplication;
  }
  if (!remembered || remembered === ENABLE_BANKING_SETUP_STEP.signIn) {
    return ENABLE_BANKING_SETUP_STEP.signIn;
  }
  // Remembered as past sign-in, but no certificate is waiting (never created, lapsed, or
  // already activated): the next thing to do is create one.
  return remembered === ENABLE_BANKING_SETUP_STEP.done
    ? ENABLE_BANKING_SETUP_STEP.signIn
    : ENABLE_BANKING_SETUP_STEP.createApplication;
}

// Per person: without a signed-in id nothing is remembered, so one person's step never reaches
// another's wizard in a shared browser.
const storageKey = (userId: string) => `wm:enable-banking-setup:step:${userId}`;

/** The step this browser remembers for this person, or null (none, no id, or storage blocked). */
export function readRememberedStep(
  userId: string | undefined,
): EnableBankingSetupStep | null {
  if (!userId) return null;
  try {
    const value = window.localStorage.getItem(storageKey(userId));
    return isStep(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberStep(
  userId: string | undefined,
  step: EnableBankingSetupStep,
): void {
  if (!userId) return;
  try {
    window.localStorage.setItem(storageKey(userId), step);
  } catch {
    // Storage blocked: the server's pending credential still says roughly where they were.
  }
}

export function forgetRememberedStep(userId: string | undefined): void {
  if (!userId) return;
  try {
    window.localStorage.removeItem(storageKey(userId));
  } catch {
    // Storage blocked: nothing was remembered.
  }
}

/**
 * The step to go back to for an error from activating the application ID, or null when the fix
 * is on the application-ID step itself (a mistyped ID, the authenticator code) or nowhere in
 * the wizard (signing in again, trying later).
 */
export function revisitStepForError(
  error: unknown,
): EnableBankingSetupStep | null {
  switch (getApiErrorCode(error)) {
    case API_ERROR_CODE.ENABLE_BANKING_APPLICATION_NOT_ACTIVATED:
      return ENABLE_BANKING_SETUP_STEP.activate;
    // Registered with another certificate (or mistyped: the message says to check the ID).
    case API_ERROR_CODE.ENABLE_BANKING_APPLICATION_NOT_FOUND:
    case API_ERROR_CODE.ENABLE_BANKING_APPLICATION_SANDBOX:
    case API_ERROR_CODE.ENABLE_BANKING_PENDING_CREDENTIAL_MISSING:
    case API_ERROR_CODE.ENABLE_BANKING_CREDENTIAL_REFUSED:
      return ENABLE_BANKING_SETUP_STEP.createApplication;
    default:
      return null;
  }
}

/** Whether the error asks for the authenticator code, so the wizard shows its field. */
export function isTotpError(error: unknown): boolean {
  const code = getApiErrorCode(error);
  return code === "totp_required" || code === "invalid_totp";
}

/**
 * How old a session may be when the wizard, the paste form or Remove opens. The API refuses every
 * change to the key (pasting, removing, certificate creation and activation) from a session older
 * than 24 hours (`SENSITIVE_SESSION_MAX_AGE_MS` in the API's
 * `services/auth/sensitive-session-age.ts`); an hour less leaves time to finish the setup.
 */
export const SETUP_SESSION_MAX_AGE_MS = 23 * 60 * 60 * 1000;

/**
 * Whether the session is recent enough to set up a key, from when it was created. Unknown
 * (an older client, a test) reads as fresh: the API still answers `session_not_fresh`, which the
 * wizard handles the same way.
 */
export function isSessionFreshForSetup(
  createdAt: Date | string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!createdAt) return true;
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return true;
  return now - created <= SETUP_SESSION_MAX_AGE_MS;
}

const REOPEN_KEY = "wm:enable-banking-setup:reopen";
const REOPEN_TTL_MS = 30 * 60 * 1000;

/**
 * What opens itself on the page, back from signing in again: the setup wizard, the paste-a-key
 * form, or the confirmation to remove the key. Each asked for the recent sign-in.
 */
export type ReopenAfterSignIn = "paste" | "remove" | "wizard";

/**
 * Before signing out to sign in again: remember to reopen `target` on this page when the person
 * comes back. Session storage, so it stays in this tab.
 */
export function markReopenAfterSignIn(
  path: string,
  target: ReopenAfterSignIn = "wizard",
  now: number = Date.now(),
): void {
  try {
    window.sessionStorage.setItem(
      REOPEN_KEY,
      JSON.stringify({ at: now, path, target }),
    );
  } catch {
    // Storage blocked: they come back to the page and open it themselves.
  }
}

/**
 * Whether `target` should open itself, back from signing in again on `path`. The mark is spent
 * by the first one of that kind on the page to ask, so only that one opens (several entry points
 * can be mounted at once, and any of them leads on to the bank list); a mark for another kind is
 * left for it.
 */
export function claimReopenAfterSignIn(
  path: string,
  target: ReopenAfterSignIn = "wizard",
  now: number = Date.now(),
): boolean {
  try {
    const raw = window.sessionStorage.getItem(REOPEN_KEY);
    if (!raw) return false;
    let mark: { at?: unknown; path?: unknown; target?: unknown };
    try {
      mark = JSON.parse(raw) as typeof mark;
    } catch {
      window.sessionStorage.removeItem(REOPEN_KEY);
      return false;
    }
    // A mark from before targets existed was the wizard's.
    if ((mark.target ?? "wizard") !== target) return false;
    window.sessionStorage.removeItem(REOPEN_KEY);
    return (
      mark.path === path &&
      typeof mark.at === "number" &&
      now - mark.at <= REOPEN_TTL_MS
    );
  } catch {
    return false;
  }
}

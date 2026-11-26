import { ApiError } from '@/lib/api/errors'
import type { EnableBankingSetupValues } from '@/lib/server/use-instance'

import type { EnableBankingCredential } from './enable-banking-credential-contract'

/**
 * Setting up an Enable Banking key on the phone, in the web wizard's five steps: sign in to
 * Enable Banking, create the application (with the certificate WonderMoney generates), activate
 * it by linking accounts, paste the application ID, then choose the bank. The ids are stable:
 * analytics (#698) and tests name the steps by them.
 */
export const ENABLE_BANKING_SETUP_STEP = {
  signIn: 'sign_in',
  createApplication: 'create_application',
  activate: 'activate',
  applicationId: 'application_id',
  chooseBank: 'choose_bank',
} as const

export type EnableBankingSetupStepId = (typeof ENABLE_BANKING_SETUP_STEP)[keyof typeof ENABLE_BANKING_SETUP_STEP]

/**
 * In order. The setup screen shows the first four; the fifth is the connect screen's bank list,
 * which takes over once the key is active and shows itself as this step.
 */
export const ENABLE_BANKING_SETUP_STEPS: readonly EnableBankingSetupStepId[] = [
  ENABLE_BANKING_SETUP_STEP.signIn,
  ENABLE_BANKING_SETUP_STEP.createApplication,
  ENABLE_BANKING_SETUP_STEP.activate,
  ENABLE_BANKING_SETUP_STEP.applicationId,
  ENABLE_BANKING_SETUP_STEP.chooseBank,
]

/** Where Enable Banking's Control Panel starts: its sign-in page, which emails a one-time link. */
export const ENABLE_BANKING_SIGN_IN_URL = 'https://enablebanking.com/sign-in/'

/** Where applications are added, once signed in. */
export const ENABLE_BANKING_APPLICATIONS_URL = 'https://enablebanking.com/cp/applications'

/** The certificate's file name when it is shared, as the web app downloads it. */
export const ENABLE_BANKING_CERTIFICATE_FILE_NAME = 'wondermoney-enable-banking.crt'

/** 1-based position, for "Step 2 of 5". */
export function enableBankingSetupStepNumber(step: EnableBankingSetupStepId): number {
  return ENABLE_BANKING_SETUP_STEPS.indexOf(step) + 1
}

const SCREEN_STEPS = ENABLE_BANKING_SETUP_STEPS.filter((step): step is EnableBankingSetupScreenStepId => step !== ENABLE_BANKING_SETUP_STEP.chooseBank)

/** The next step on the setup screen; the last one (pasting the ID) moves on by activating, not by this. */
export function nextEnableBankingSetupStep(step: EnableBankingSetupScreenStepId): EnableBankingSetupScreenStepId {
  const index = SCREEN_STEPS.indexOf(step)
  return SCREEN_STEPS[Math.min(index + 1, SCREEN_STEPS.length - 1)] ?? step
}

export function previousEnableBankingSetupStep(step: EnableBankingSetupScreenStepId): EnableBankingSetupScreenStepId | null {
  const index = SCREEN_STEPS.indexOf(step)
  return index > 0 ? (SCREEN_STEPS[index - 1] ?? null) : null
}

/** The steps the setup screen itself shows: all but choosing the bank. */
export type EnableBankingSetupScreenStepId = Exclude<EnableBankingSetupStepId, typeof ENABLE_BANKING_SETUP_STEP.chooseBank>

/**
 * Where the setup opens. The server's pending credential is the progress: with a certificate
 * waiting for its application ID, the person has already been through the Control Panel at least
 * as far as creating it, so they resume at pasting the ID (an error there points back to the step
 * to redo). The setup only shows without an active key, so it never opens on the bank list.
 */
export function initialEnableBankingSetupStep(credential: EnableBankingCredential | undefined): EnableBankingSetupScreenStepId {
  return credential?.pending ? ENABLE_BANKING_SETUP_STEP.applicationId : ENABLE_BANKING_SETUP_STEP.signIn
}

/**
 * How old a session may be for the API's sensitive actions (`SENSITIVE_SESSION_MAX_AGE_MS`, 24
 * hours), less the time the setup may take, so a session that is fresh at step 1 is still fresh
 * at step 4.
 */
export const SETUP_SESSION_MAX_AGE_MS = 22 * 60 * 60 * 1000

/**
 * Whether to offer "Sign in again" before step 1: the session is too old to finish the setup.
 * Unknown (null, or a date that doesn't parse) reads as fresh; the server still says if not.
 */
export function sessionTooOldForSetup(startedAt: string | null, now: number = Date.now()): boolean {
  if (!startedAt) return false
  const started = Date.parse(startedAt)
  if (Number.isNaN(started)) return false
  return now - started > SETUP_SESSION_MAX_AGE_MS
}

/** When a certificate made earlier lapses, or null when none is waiting. */
export function pendingCertificateExpiry(credential: EnableBankingCredential | undefined): string | null {
  return credential?.pending?.expiresAt ?? null
}

export type EnableBankingControlPanelField = 'name' | 'description' | 'redirectUrl' | 'privacyUrl' | 'termsUrl'

export type EnableBankingControlPanelValue = Readonly<{ field: EnableBankingControlPanelField; value: string }>

/**
 * The values to copy into the Control Panel's form, in the form's order. Environment is not
 * here: it is a choice (Production), shown as a warning rather than a value to copy.
 */
export function enableBankingControlPanelValues(setup: EnableBankingSetupValues | null): readonly EnableBankingControlPanelValue[] {
  if (!setup) return []
  return [
    { field: 'name', value: setup.applicationName },
    { field: 'description', value: setup.applicationDescription },
    { field: 'redirectUrl', value: setup.redirectUrl },
    { field: 'privacyUrl', value: setup.privacyUrl },
    { field: 'termsUrl', value: setup.termsUrl },
  ]
}

/** Strips what a paste brings along (spaces, line breaks) from an application ID. */
export function normalizeApplicationId(raw: string): string {
  return raw.replace(/\s+/g, '')
}

export type EnableBankingSetupFailureReason =
  | 'application-not-found'
  | 'sandbox'
  | 'not-activated'
  | 'refused'
  | 'pending-missing'
  | 'totp-required'
  | 'invalid-totp'
  | 'session-not-fresh'
  | 'rate-limited'
  | 'demo'
  | 'read-only'
  | 'network'
  | 'unavailable'
  | 'general'

export type EnableBankingSetupFailure = Readonly<{
  reason: EnableBankingSetupFailureReason
  /** The step to go back to and redo, when the fix is there; null when it is on this step. */
  revisit: EnableBankingSetupScreenStepId | null
}>

/** The API's codes (#695), each with its own reason and the step where the person fixes it. */
const BY_SERVER_CODE: Readonly<Record<string, EnableBankingSetupFailure>> = {
  // A mistyped ID is fixed here; an application registered with another certificate, in step 2.
  enable_banking_application_not_found: { reason: 'application-not-found', revisit: ENABLE_BANKING_SETUP_STEP.createApplication },
  enable_banking_application_sandbox: { reason: 'sandbox', revisit: ENABLE_BANKING_SETUP_STEP.createApplication },
  enable_banking_application_not_activated: { reason: 'not-activated', revisit: ENABLE_BANKING_SETUP_STEP.activate },
  enable_banking_credential_refused: { reason: 'refused', revisit: ENABLE_BANKING_SETUP_STEP.createApplication },
  enable_banking_pending_credential_missing: { reason: 'pending-missing', revisit: ENABLE_BANKING_SETUP_STEP.createApplication },
  totp_required: { reason: 'totp-required', revisit: null },
  invalid_totp: { reason: 'invalid-totp', revisit: null },
  session_not_fresh: { reason: 'session-not-fresh', revisit: null },
}

const failure = (reason: EnableBankingSetupFailureReason): EnableBankingSetupFailure => ({ reason, revisit: null })

/** Why creating the certificate or activating the key did not go through. */
export function classifyEnableBankingSetupFailure(error: unknown): EnableBankingSetupFailure {
  if (!(error instanceof ApiError)) return failure('general')
  if (error.code === 'demo-forbidden') return failure('demo')
  // A household viewer: adding a key is for linking banks, a shared write.
  if (error.code === 'household-read-only') return failure('read-only')
  if (error.code === 'network' || error.code === 'cancelled') return failure('network')
  if (error.code !== 'http') return failure('general')
  const known = error.serverCode ? BY_SERVER_CODE[error.serverCode] : undefined
  if (known) return known
  if (error.status === 429) return failure('rate-limited')
  if ((error.status ?? 0) >= 500) return failure('unavailable')
  return failure('general')
}

/** The failure's own message, under `banking.keySetup.errors`. */
export function enableBankingSetupFailureMessageKey(reason: EnableBankingSetupFailureReason): string {
  const keys: Record<EnableBankingSetupFailureReason, string> = {
    'application-not-found': 'applicationNotFound',
    sandbox: 'sandbox',
    'not-activated': 'notActivated',
    refused: 'refused',
    'pending-missing': 'pendingMissing',
    'totp-required': 'totpRequired',
    'invalid-totp': 'invalidTotp',
    'session-not-fresh': 'sessionNotFresh',
    'rate-limited': 'rateLimited',
    demo: 'demo',
    'read-only': 'read-only',
    network: 'network',
    unavailable: 'unavailable',
    general: 'general',
  }
  return `banking.keySetup.errors.${keys[reason]}`
}

/** The code field shows once the server has asked for it (two-factor is on), and stays for the next sensitive step. */
export function failureAsksForCode(reason: EnableBankingSetupFailureReason): boolean {
  return reason === 'totp-required' || reason === 'invalid-totp'
}

/** The certificate was replaced or lapsed: the one made earlier is no use, a new one is needed. */
export function failureNeedsNewCertificate(reason: EnableBankingSetupFailureReason): boolean {
  return reason === 'pending-missing'
}

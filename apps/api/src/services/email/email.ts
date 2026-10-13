import { randomUUID } from 'node:crypto';

import { renderAccountConnectedEmail, renderInternalAlertEmail, renderLifecycleNudgeEmail } from '@wondermoney/react-email';
import dotenv from 'dotenv';
import { type CreateEmailOptions, type CreateEmailRequestOptions, type CreateEmailResponse, type CreateEmailResponseSuccess, Resend } from 'resend';

import { SHOULD_INTERCEPT_EMAILS } from '@config/env';
import { SupportedLanguages } from '@entity/Appuser';
import { emailGlobalOptOutService, GLOBAL_EMAIL_OPT_OUT_CATEGORY } from '@service/email/email-global-opt-out.service';
import { type EmailOutcome, emailSender, resolveEmailDriver, sendWithTransport, supportInbox } from '@service/email/email-transport';
import { BACKEND_URL, FRONTEND_URL } from '@utils/constants';
import logger from '@utils/logger';

/**
 * Minimal HTML escape for interpolating user-controlled values into inline email HTML
 * (the better-auth password-reset / email-verification callbacks). Newline-preserving,
 * double-quote/escape-safe; intentionally not a general-purpose escaper.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

dotenv.config({ quiet: true });

/** Maps the API's `EN`/`PT` to the react-email renderers' `en`/`pt`. */
const toRenderLang = (language: LANGUAGE): 'en' | 'pt' => (language.toUpperCase() === 'PT' ? 'pt' : 'en');
const appBase = () => FRONTEND_URL.replace(/\/$/u, '');
const backendBase = () => BACKEND_URL.replace(/\/$/u, '');

const getResend = () => {
  const { RESEND_API_KEY } = process.env;
  if (!RESEND_API_KEY) {
    throw new Error('Resend API key required in .env file');
  }
  return new Resend(RESEND_API_KEY);
};

/** Formats a `Name <email>` sender/recipient string for Resend, or a bare address when unnamed. */
const formatAddress = (email: string, name?: string) => (name ? `${name} <${email}>` : email);

/**
 * Default wall-clock budget for one Resend send. Applies to `sendRenderedEmail`, which
 * previously had none at all.
 */
const DEFAULT_SEND_TIMEOUT_MS = 20_000;

export interface RenderedEmailInput {
  attachments?: { content: string; contentType: string; filename: string }[];
  /**
   * Provider-side dedup key. Worth passing on any send that a job may retry: it turns a
   * double-send window into a provider-side no-op even if the local claim is lost.
   */
  idempotencyKey?: string;
  /** Overrides {@link DEFAULT_SEND_TIMEOUT_MS}. */
  timeoutMs?: number;
  /**
   * Overrides the default `RESEND_FROM_EMAIL` sender. Only for mail that is
   * genuinely from a person rather than from the product — the RAD-583 founder
   * outreach asks for a reply and would read as marketing if it arrived from
   * `hello@`. Must be an address on an already-verified Resend domain.
   */
  from?: { email: string; name?: string };
  headers: Record<string, string>;
  html: string;
  preheader?: string;
  replyTo?: { email: string; name?: string };
  subject: string;
  text: string;
  to: { email: string; name?: string };
}

export type RenderedEmailOutcome = EmailOutcome;

/**
 * Resend's published `CreateEmailRequestOptions` type has no `signal`, but its client does
 * `fetchRequest(path, { method, body, ...options, headers })` and hands that object
 * straight to `fetch` — so a signal passed here really does reach the socket. Verified
 * against the SDK's compiled `post()`/`fetchRequest()`, not inferred from the types.
 *
 * On abort, `fetchRequest`'s catch-all returns `statusCode: null`, which
 * `classifyRenderedOutcome` already maps to `unknown` — i.e. "we cannot know whether this
 * was delivered". That is the correct classification for a cancelled send, and the
 * delivery state machines treat it as terminal rather than retrying it.
 */
type LANGUAGE = keyof typeof SupportedLanguages;

type SendRequestOptions = CreateEmailRequestOptions & { signal?: AbortSignal };

export function isEmailInterceptionEnabled() {
  return SHOULD_INTERCEPT_EMAILS;
}

export async function sendRenderedEmail(input: RenderedEmailInput): Promise<RenderedEmailOutcome> {
  validateRenderedInput(input);
  if (isEmailInterceptionEnabled()) return { type: 'intercepted' };
  const sender = emailSender();
  const from = input.from ? formatAddress(input.from.email, input.from.name) : formatAddress(sender.email, sender.name);
  if (resolveEmailDriver() !== 'resend') {
    return sendWithTransport({
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      from,
      ...(Object.keys(input.headers).length ? { headers: input.headers } : {}),
      html: input.html,
      ...(input.replyTo ? { replyTo: formatAddress(input.replyTo.email, input.replyTo.name) } : {}),
      subject: input.subject,
      text: input.text,
      to: formatAddress(input.to.email, input.to.name),
    }, { signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS) });
  }
  // Resend's SDK sets no transport timeout, so this call could hang forever. Every queue
  // that sends email runs at `batchSize: 1`, so one hung send freezes that queue outright.
  // The signal is forwarded to the SDK (rather than raced against it) so aborting actually
  // tears the socket down — a deadline that leaves the request in flight produces the
  // worst possible outcome: recorded as timed out, delivered anyway.
  const abort = AbortSignal.timeout(input.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS);
  const result = await getResend().emails.send({
    ...(input.attachments?.length ? { attachments: input.attachments.map((a) => ({ content: a.content, contentType: a.contentType, filename: a.filename })) } : {}),
    from,
    ...(Object.keys(input.headers).length ? { headers: input.headers } : {}),
    html: input.html,
    ...(input.replyTo ? { replyTo: formatAddress(input.replyTo.email, input.replyTo.name) } : {}),
    subject: input.subject,
    text: input.text,
    to: formatAddress(input.to.email, input.to.name),
  }, { ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}), signal: abort } satisfies SendRequestOptions as CreateEmailRequestOptions);
  return classifyRenderedOutcome(result);
}

/**
 * Maps a Resend send result to the provider-neutral outcome the delivery pipeline persists.
 * Resend never throws for send/network failures — a network failure returns `statusCode: null`,
 * which we treat as `unknown` (we cannot know whether the message was accepted).
 */
function classifyRenderedOutcome(result: CreateEmailResponse): RenderedEmailOutcome {
  const error = result.error;
  const data: CreateEmailResponseSuccess | null = result.data;
  if (error) {
    const status = error.statusCode;
    if (status == null) return { type: 'unknown' };
    if (status === 429 || status >= 500) return { errorCode: error.name, retryable: true, type: 'rejected' };
    if (status >= 400) return { errorCode: error.name, retryable: false, type: 'rejected' };
    return { type: 'unknown' };
  }
  return data?.id ? { providerMessageIds: [data.id], type: 'accepted' } : { type: 'unknown' };
}

function validateRenderedInput(input: RenderedEmailInput) {
  for (const [field, value] of Object.entries({ html: input.html, subject: input.subject, text: input.text, to: input.to.email })) {
    if (!value.trim()) throw new Error(`Rendered email ${field} is required`);
  }
}

/**
 * Renders an internal/ops alert with the branded `internal-alert` template and sends it to a
 * WonderMoney team inbox (info@/alerts@/support@) via `sendRenderedEmail` (interception, provider
 * send, headers all handled there). These recipients are the team, not users, so the template is
 * English-only by design — no localization (RAD-326).
 */
export interface BankRecoveryEmailInput {
  /** Display name of the bank the interrupted attempt was with, if known. */
  bankName?: string;
  incidentId: string;
  language: 'EN' | 'PT';
  recipient: string;
  recoveryUrl: string;
  signal?: AbortSignal;
  templateVersion: string;
  /** Category-scoped (`EmailCategory.ACCOUNT_RECOVERY`) one-click unsubscribe link; carried as a `List-Unsubscribe` header. */
  unsubscribeUrl: string;
}

export type BankRecoveryEmailOutcome =
  | {
    code: 'local_provider_setup_failed' | 'provider_rate_limited';
    status: 'pre_acceptance_retryable';
  }
  | {
    code:
      | 'invalid_identifier'
      | 'invalid_language'
      | 'invalid_recipient'
      | 'invalid_recovery_url'
      | `provider_rejected_${400 | 401 | 403 | 422}`;
    status: 'pre_acceptance_permanent';
  }
  | {
    code:
      | 'provider_5xx'
      | 'provider_malformed_response'
      | 'provider_network_error'
      | 'provider_timeout'
      | 'provider_unknown';
    status: 'ambiguous';
  }
  | { messageId: string };

export interface BankRecoveryEmailProviderSeam {
  /** Injects the Resend send call for test isolation; defaults to the real Resend client. */
  send?: (payload: CreateEmailOptions, options?: CreateEmailRequestOptions) => Promise<CreateEmailResponse>;
}

interface AccountDeletedData {
  appuserKey: number;
  deletedAt: Date;
  userEmail: string;
}

interface AccountSyncData {
  bankName: string;
}

interface SignupData {
  userEmail: string;
}
interface SupportEmailData {
  email: string;
  message: string;
  name: string;
}

/** Sends a team alert to `SUPPORT_EMAIL`; without one there is nobody to send it to, so it is logged. */
async function sendInternalAlert(
  props: { details?: { label: string; value: string }[]; intro?: string; subject: string; title: string; variant?: 'info' | 'warning' },
): Promise<RenderedEmailOutcome> {
  const inbox = supportInbox();
  if (!inbox) {
    logger.info({ alert: { details: props.details, subject: props.subject, title: props.title } }, 'Internal alert not emailed: SUPPORT_EMAIL is not set');
    return { type: 'intercepted' };
  }
  const rendered = await renderInternalAlertEmail(props);
  return sendRenderedEmail({ headers: {}, html: rendered.html, subject: rendered.subject, text: rendered.text, to: { email: inbox } });
}

const BANK_RECOVERY_COPY = {
  EN: {
    body: [
      "Your bank connection didn't finish, so your accounts may be out of date in WonderMoney.",
      "Reopen WonderMoney and retry the connection from the app. It only takes a moment. If it still doesn't work, just reply and we'll help.",
    ],
    cta: 'Retry the connection',
    heading: "Let's finish connecting your bank",
    step1DetailFallback: "The last attempt didn't reach linked status",
    step1DetailWithBank: (bankName: string) => `Attempt with ${bankName}`,
    step1Label: 'Attempt interrupted',
    step2Detail: 'Confirm the authorization with your bank again',
    step2Label: 'Resume the connection',
    subject: 'Your bank connection needs another try',
  },
  PT: {
    body: [
      'A sua ligação bancária não ficou concluída, por isso as suas contas podem não estar atualizadas na WonderMoney.',
      'Volte a abrir a WonderMoney e tente novamente a ligação a partir da aplicação. Demora só um momento. Se continuar a falhar, responda a este email e ajudamos.',
    ],
    cta: 'Tentar novamente',
    heading: 'Vamos concluir a ligação ao seu banco',
    step1DetailFallback: 'A última tentativa não chegou ao estado ligado',
    step1DetailWithBank: (bankName: string) => `Tentativa com ${bankName}`,
    step1Label: 'Tentativa interrompida',
    step2Detail: 'Volte a confirmar a autorização junto do banco',
    step2Label: 'Retomar a ligação',
    subject: 'A sua ligação bancária precisa de nova tentativa',
  },
} as const;

const SAFE_IDENTIFIER = /^[A-Za-z0-9][\w.-]{0,127}$/u;
/** Resend message ids are standard UUIDs. */
const SAFE_MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function sendAccountDeletedEmail(data: AccountDeletedData) {
  return sendInternalAlert(
    {
      details: [
        { label: 'User email', value: data.userEmail },
        { label: 'Appuser key', value: String(data.appuserKey) },
        { label: 'Deleted at', value: data.deletedAt.toISOString() },
      ],
      subject: 'Wonder.money - Account deleted',
      title: 'Account deleted',
      variant: 'info',
    },
  );
}

/**
 * "New bank connected" confirmation to the user after an account sync links a bank.
 */
export async function sendAccountSyncEmail(to: { email: string; name?: string }, data: AccountSyncData, language: LANGUAGE) {
  const lang = toRenderLang(language);
  const rendered = await renderAccountConnectedEmail({
    bankName: data.bankName,
    dashboardUrl: `${appBase()}/${lang}/accounts`,
    firstName: to.name ?? undefined,
    language: lang,
  });
  return sendRenderedEmail({ headers: {}, html: rendered.html, subject: rendered.subject, text: rendered.text, to });
}

export function sendPasswordResetEmail(to: { email: string; name?: string }, resetUrl: string) {
  const name = to.name ?? to.email.split('@')[0] ?? '';
  return sendRenderedEmail({
    headers: {},
    html: `<p>Hi ${escapeHtml(name)},</p><p>We received a request to reset your Wonder.money password. Click the link below to choose a new one:</p><p><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p><p>If you didn't request this, you can safely ignore this email — your password won't change.</p><p>— The Wonder.money team</p>`,
    subject: 'Reset your Wonder.money password',
    text: `Hi ${name},

We received a request to reset your Wonder.money password. Click the link below to choose a new one:

${resetUrl}

If you didn't request this, you can safely ignore this email — your password won't change.

— The Wonder.money team`,
    to,
  });
}

/**
 * Email-verification email for better-auth's `sendVerificationEmail` callback (branded,
 * in-process, plain-text, carrying the verification link).
 */
export function sendEmailVerificationEmail(to: { email: string; name?: string }, verificationUrl: string) {
  const name = to.name ?? to.email.split('@')[0] ?? '';
  return sendRenderedEmail({
    headers: {},
    html: `<p>Hi ${escapeHtml(name)},</p><p>Welcome to Wonder.money! Please confirm your email address by clicking the link below:</p><p><a href="${escapeHtml(verificationUrl)}">${escapeHtml(verificationUrl)}</a></p><p>If you didn't create a Wonder.money account, you can safely ignore this email.</p><p>— The Wonder.money team</p>`,
    subject: 'Verify your Wonder.money email',
    text: `Hi ${name},

Welcome to Wonder.money! Please confirm your email address by clicking the link below:

${verificationUrl}

If you didn't create a Wonder.money account, you can safely ignore this email.

— The Wonder.money team`,
    to,
  });
}

/**
 * Sends the bank recovery nudge. The recipient is only placed in the provider
 * payload; this path does not log or persist it.
 */
export async function sendBankRecoveryEmail(
  input: BankRecoveryEmailInput,
  seam: BankRecoveryEmailProviderSeam = {},
): Promise<BankRecoveryEmailOutcome> {
  if (input.signal?.aborted) return { code: 'provider_timeout', status: 'ambiguous' };
  if (!Object.hasOwn(BANK_RECOVERY_COPY, input.language)) {
    return { code: 'invalid_language', status: 'pre_acceptance_permanent' };
  }
  if (!isValidRecoveryUrl(input.recoveryUrl)) {
    return { code: 'invalid_recovery_url', status: 'pre_acceptance_permanent' };
  }
  if (!SAFE_IDENTIFIER.test(input.incidentId) || !SAFE_IDENTIFIER.test(input.templateVersion)) {
    return { code: 'invalid_identifier', status: 'pre_acceptance_permanent' };
  }
  if (!isValidRecipient(input.recipient)) {
    return { code: 'invalid_recipient', status: 'pre_acceptance_permanent' };
  }

  const copy = BANK_RECOVERY_COPY[input.language];
  let rendered;
  try {
    rendered = await renderLifecycleNudgeEmail({
      body: [...copy.body],
      ctaLabel: copy.cta,
      ctaUrl: input.recoveryUrl,
      heading: copy.heading,
      language: input.language === 'PT' ? 'pt' : 'en',
      steps: [
        { detail: input.bankName ? copy.step1DetailWithBank(input.bankName) : copy.step1DetailFallback, label: copy.step1Label },
        { detail: copy.step2Detail, label: copy.step2Label },
      ],
      subject: copy.subject,
      unsubscribeUrl: input.unsubscribeUrl,
    });
  } catch {
    return { code: 'local_provider_setup_failed', status: 'pre_acceptance_retryable' };
  }
  const sender = emailSender();
  const payload: CreateEmailOptions = {
    from: formatAddress(sender.email, sender.name),
    headers: { 'List-Unsubscribe': `<${input.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    html: rendered.html,
    subject: rendered.subject,
    text: rendered.text,
    to: input.recipient,
  };

  if (!seam.send && resolveEmailDriver() !== 'resend') {
    const outcome = await sendWithTransport({ from: payload.from, headers: payload.headers ?? {}, html: rendered.html, subject: rendered.subject, text: rendered.text, to: input.recipient }, input.signal ? { signal: input.signal } : {});
    return toBankRecoveryOutcome(outcome);
  }

  let send: (payload: CreateEmailOptions, options?: CreateEmailRequestOptions) => Promise<CreateEmailResponse>;
  try {
    if (seam.send) {
      send = seam.send;
    } else {
      const client = getResend();
      send = (body, options) => client.emails.send(body, options);
    }
  } catch {
    return { code: 'local_provider_setup_failed', status: 'pre_acceptance_retryable' };
  }

  let result: CreateEmailResponse;
  try {
    // The signal is FORWARDED, not merely checked at entry. The caller's 20 s deadline
    // used to be a `Promise.race` whose loser kept running: the delivery was recorded
    // `provider_timeout` while the HTTP request was still in flight and could still
    // deliver — which, combined with a non-atomic status write, is how a "timed out"
    // email gets sent twice.
    result = await send(payload, { idempotencyKey: `${input.incidentId}:${input.templateVersion}`, ...(input.signal ? { signal: input.signal } : {}) } satisfies SendRequestOptions as CreateEmailRequestOptions);
  } catch {
    return { code: 'provider_unknown', status: 'ambiguous' };
  }
  return classifyBankRecoveryResult(result);
}

/** Maps a non-Resend transport outcome onto the bank-recovery delivery states. */
export function sendSignupEmail(data: SignupData, language: LANGUAGE) {
  const subject = language === 'PT' ? 'Wonder.money - INTERNAL Registo de Utilizador' : 'Wonder.money - INTERNAL User Signup';
  return sendInternalAlert(
    { details: [{ label: 'Email', value: data.userEmail }], subject, title: 'New user signup', variant: 'info' },
  );
}

export function sendSupportEmail(data: SupportEmailData) {
  return sendInternalAlert(
    {
      details: [
        { label: 'Name', value: data.name },
        { label: 'Email', value: data.email },
      ],
      intro: data.message,
      subject: 'Wonder.money - Support',
      title: 'Support request',
      variant: 'info',
    },
  );
}

function toBankRecoveryOutcome(outcome: RenderedEmailOutcome): BankRecoveryEmailOutcome {
  if (outcome.type === 'accepted') return { messageId: randomUUID() };
  if (outcome.type === 'rejected') {
    return outcome.retryable
      ? { code: 'provider_rate_limited', status: 'pre_acceptance_retryable' }
      : { code: 'provider_rejected_422', status: 'pre_acceptance_permanent' };
  }
  return { code: 'provider_unknown', status: 'ambiguous' };
}

/* ── Transactional / account user emails (Tasks 2–5) ─────────────────────────────────────────
 * These are ACCOUNT emails, not marketing: callers send them regardless of marketing opt-out and the
 * notification-preference toggles (those only gate budget/weekly/lifecycle). They reuse the branded
 * `lifecycle-nudge` shell, which renders an unsubscribe/settings footer — so `unsubscribeUrl` points at
 * a real account-wide opt-out (honest: it turns off optional email, never these transactional sends) and
 * `settingsUrl` at the relevant page. Footer-free transactional templates would need a separate
 * react-email publish (out of scope; noted in the handoff). Copy is EN + PT, selected by `language`. */

/** Minimal user identity every transactional sender needs. */
export interface TransactionalUserEmailInput {
  appuserKey: number;
  emailAddress: string;
  firstName?: string;
  language: LANGUAGE;
}

interface TransactionalNudgeCopy {
  body: string[];
  ctaLabel: string;
  heading: string;
  preheader?: string;
  subject: string;
}

/** Account-wide ("all") email opt-out link for the branded footer + List-Unsubscribe header. */
const accountOptOutUrl = (appuserKey: number) =>
  `${backendBase()}/v1/marketing/email-opt-out?token=${encodeURIComponent(emailGlobalOptOutService.generateCategoryToken(appuserKey, GLOBAL_EMAIL_OPT_OUT_CATEGORY))}`;

/** Renders the `lifecycle-nudge` shell with the given copy and delivers it as a transactional send. */
async function sendTransactionalNudge(
  input: TransactionalUserEmailInput,
  copy: TransactionalNudgeCopy,
  links: { ctaUrl: string; settingsUrl: string },
) {
  const lang = toRenderLang(input.language);
  const unsubscribeUrl = accountOptOutUrl(input.appuserKey);
  const rendered = await renderLifecycleNudgeEmail({
    body: copy.body,
    ctaLabel: copy.ctaLabel,
    ctaUrl: links.ctaUrl,
    ...(input.firstName ? { firstName: input.firstName } : {}),
    heading: copy.heading,
    language: lang,
    ...(copy.preheader ? { preheader: copy.preheader } : {}),
    settingsUrl: links.settingsUrl,
    subject: copy.subject,
    unsubscribeUrl,
  });
  return sendRenderedEmail({
    headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    html: rendered.html,
    subject: rendered.subject,
    text: rendered.text,
    to: { email: input.emailAddress, ...(input.firstName ? { name: input.firstName } : {}) },
  });
}

/* Task 2 — Welcome / onboarding (trigger: signup). CTA → app home. */
const WELCOME_COPY: Record<'EN' | 'PT', TransactionalNudgeCopy> = {
  EN: {
    body: [
      'Thanks for signing up — your account is ready to go.',
      'WonderMoney brings your accounts, budgets and investments together in one place. Connect your first account to watch everything come to life.',
      'Any questions? Just reply to this email — a real person reads it.',
    ],
    ctaLabel: 'Open WonderMoney',
    heading: 'Welcome to WonderMoney',
    preheader: 'Your account is ready — here is how to get started.',
    subject: 'Welcome to WonderMoney 🎉',
  },
  PT: {
    body: [
      'Obrigado por te registares — a tua conta está pronta.',
      'A WonderMoney reúne as tuas contas, orçamentos e investimentos num só lugar. Liga a tua primeira conta para veres tudo a ganhar vida.',
      'Alguma dúvida? Responde a este email — é uma pessoa a sério que o lê.',
    ],
    ctaLabel: 'Abrir a WonderMoney',
    heading: 'Bem-vindo à WonderMoney',
    preheader: 'A tua conta está pronta — começa por aqui.',
    subject: 'Bem-vindo à WonderMoney 🎉',
  },
};

export function sendWelcomeEmail(input: TransactionalUserEmailInput) {
  const lang = toRenderLang(input.language);
  return sendTransactionalNudge(input, WELCOME_COPY[input.language], {
    ctaUrl: `${appBase()}/${lang}`,
    settingsUrl: `${appBase()}/${lang}/settings`,
  });
}

/**
 * Maps a Resend send result to the bank-recovery outcome taxonomy the worker/service branch on.
 * Resend never throws for send/network failures, so every non-success arrives here as an `error`
 * with a `statusCode` (or `null` for an unresolved request, treated as ambiguous — maybe sent).
 */
function classifyBankRecoveryResult(result: CreateEmailResponse): BankRecoveryEmailOutcome {
  const error = result.error;
  const data: CreateEmailResponseSuccess | null = result.data;
  if (error) {
    const status = error.statusCode;
    if (status === 400 || status === 401 || status === 403 || status === 422) {
      return { code: `provider_rejected_${status}`, status: 'pre_acceptance_permanent' };
    }
    if (status === 429) return { code: 'provider_rate_limited', status: 'pre_acceptance_retryable' };
    if (status != null && status >= 500) return { code: 'provider_5xx', status: 'ambiguous' };
    if (status == null) return { code: 'provider_network_error', status: 'ambiguous' };
    return { code: 'provider_unknown', status: 'ambiguous' };
  }
  const id = data?.id;
  return typeof id === 'string' && SAFE_MESSAGE_ID.test(id)
    ? { messageId: id }
    : { code: 'provider_malformed_response', status: 'ambiguous' };
}

function isValidRecipient(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/u.test(value);
}

function isValidRecoveryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0 && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

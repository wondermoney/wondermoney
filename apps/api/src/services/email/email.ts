import { randomUUID } from 'node:crypto';

import { renderAccountConnectedEmail, renderInternalAlertEmail, renderLifecycleNudgeEmail } from '@wondermoney/react-email';
import dotenv from 'dotenv';
import { type CreateEmailOptions, type CreateEmailRequestOptions, type CreateEmailResponse, type CreateEmailResponseSuccess, Resend } from 'resend';

import { SHOULD_INTERCEPT_EMAILS } from '@config/env';
import { instanceName } from '@config/instance-name';
import { SupportedLanguages } from '@entity/Appuser';
import { emailGlobalOptOutService, GLOBAL_EMAIL_OPT_OUT_CATEGORY } from '@service/email/email-global-opt-out.service';
import { type EmailOutcome, emailSender, resolveEmailDriver, sendWithTransport, supportInbox } from '@service/email/email-transport';
import { type AccountLanguage, accountLocale, copyLocale } from '@utils/account-language';
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

/**
 * The copy languages of the texts in this file and of the react-email shells they render
 * (`TransactionalEmailLanguage`): English, Portuguese and Spanish. An account language outside
 * this list reads English. Links into the app use the account's own locale (`accountLocale`).
 */
const COPY_LOCALES = ['en', 'pt', 'es'] as const;
const copyLang = (language: LANGUAGE) => copyLocale(language, COPY_LOCALES);
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
 * Default wall-clock budget for one Resend send. Applies to `sendRenderedEmail`.
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
   * Overrides the default sender (`EMAIL_FROM`). Only for mail that is
   * genuinely from a person rather than from the product — founder outreach
   * asks for a reply and would read as marketing if it arrived from
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

type LANGUAGE = AccountLanguage;
const LANGUAGES: readonly string[] = Object.values(SupportedLanguages);

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
  // worst possible outcome: recorded as timed out, delivered anyway. The SDK passes the
  // options straight to `fetch`; on abort it returns `statusCode: null`, which
  // `classifyRenderedOutcome` maps to `unknown` ("we cannot know whether this was delivered"),
  // and the delivery state machines treat that as terminal rather than retrying it.
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
  }, { ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}), signal: abort } satisfies CreateEmailRequestOptions);
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
 * English-only by design — no localization.
 */
export interface BankRecoveryEmailInput {
  /** Display name of the bank the interrupted attempt was with, if known. */
  bankName?: string;
  incidentId: string;
  language: LANGUAGE;
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

export type FeedbackType = 'bug' | 'feature_request' | 'other';

interface AccountDeletedData {
  appuserKey: number;
  deletedAt: Date;
  userEmail: string;
}

interface AccountSyncData {
  bankName: string;
}
interface FeedbackEmailData {
  email: string;
  message: string;
  name?: string;
  page?: string;
  type: FeedbackType;
}

interface SignupData {
  userEmail: string;
}

interface SupportEmailData {
  email: string;
  message: string;
  name: string;
}

const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = { bug: 'Bug', feature_request: 'Feature request', other: 'Other' };

/** Sends a team alert to `SUPPORT_EMAIL`; without one there is nobody to send it to, so it is logged. */
async function sendInternalAlert(
  props: { details?: { label: string; value: string }[]; intro?: string; subject: string; title: string; variant?: 'info' | 'warning' },
  options: { replyTo?: { email: string; name?: string } } = {},
): Promise<RenderedEmailOutcome> {
  const inbox = supportInbox();
  if (!inbox) {
    logger.info({ alert: { details: props.details, subject: props.subject, title: props.title } }, 'Internal alert not emailed: SUPPORT_EMAIL is not set');
    return { type: 'intercepted' };
  }
  const rendered = await renderInternalAlertEmail(props);
  return sendRenderedEmail({ headers: {}, html: rendered.html, ...(options.replyTo ? { replyTo: options.replyTo } : {}), subject: rendered.subject, text: rendered.text, to: { email: inbox } });
}

const BANK_RECOVERY_COPY = {
  en: {
    body: [
      (brand: string) => `Your bank connection didn't finish, so your accounts may be out of date in ${brand}.`,
      (brand: string) => `Reopen ${brand} and retry the connection from the app. It only takes a moment. If it still doesn't work, just reply and we'll help.`,
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
  es: {
    body: [
      (brand: string) => `Tu conexión bancaria no llegó a completarse, así que es posible que tus cuentas no estén al día en ${brand}.`,
      (brand: string) => `Vuelve a abrir ${brand} e intenta de nuevo la conexión desde la aplicación. Solo lleva un momento. Si sigue sin funcionar, responde a este correo y te ayudamos.`,
    ],
    cta: 'Reintentar la conexión',
    heading: 'Terminemos de conectar tu banco',
    step1DetailFallback: 'El último intento no llegó a quedar conectado',
    step1DetailWithBank: (bankName: string) => `Intento con ${bankName}`,
    step1Label: 'Intento interrumpido',
    step2Detail: 'Vuelve a confirmar la autorización con tu banco',
    step2Label: 'Retomar la conexión',
    subject: 'Tu conexión bancaria necesita otro intento',
  },
  pt: {
    body: [
      (brand: string) => `A tua ligação bancária não ficou concluída, por isso as tuas contas podem não estar atualizadas na ${brand}.`,
      (brand: string) => `Volta a abrir a ${brand} e tenta novamente a ligação a partir da aplicação. Demora só um momento. Se continuar a falhar, responde a este email e ajudamos.`,
    ],
    cta: 'Tentar novamente',
    heading: 'Vamos concluir a ligação ao teu banco',
    step1DetailFallback: 'A última tentativa não chegou ao estado ligado',
    step1DetailWithBank: (bankName: string) => `Tentativa com ${bankName}`,
    step1Label: 'Tentativa interrompida',
    step2Detail: 'Volta a confirmar a autorização junto do banco',
    step2Label: 'Retomar a ligação',
    subject: 'A tua ligação bancária precisa de nova tentativa',
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
      subject: `${instanceName()} - Account deleted`,
      title: 'Account deleted',
      variant: 'info',
    },
  );
}

/**
 * "New bank connected" confirmation to the user after an account sync links a bank.
 */
export async function sendAccountSyncEmail(to: { email: string; name?: string }, data: AccountSyncData, language: LANGUAGE) {
  const lang = copyLang(language);
  const rendered = await renderAccountConnectedEmail({
    bankName: data.bankName,
    brandName: instanceName(),
    dashboardUrl: `${appBase()}/${accountLocale(language)}/accounts`,
    firstName: to.name ?? undefined,
    language: lang,
  });
  return sendRenderedEmail({ headers: {}, html: rendered.html, subject: rendered.subject, text: rendered.text, to });
}

const API_TOKEN_EXPIRY_COPY = {
  en: {
    body: (name: string, tokenName: string, expiresOn: string, brand: string) =>
      `Hi ${name},<p>The API token <strong>${tokenName}</strong> you created in ${brand} expires on ${expiresOn}.</p><p>If a script, spreadsheet or dashboard uses it, create a replacement in Settings → API tokens before then. The old token stops working on its expiry date.</p><p>If you no longer need it, you can revoke it now in the same place.</p>`,
    subject: (brand: string) => `Your ${brand} API token expires soon`,
    text: (name: string, tokenName: string, expiresOn: string, brand: string) =>
      `Hi ${name},\n\nThe API token "${tokenName}" you created in ${brand} expires on ${expiresOn}.\n\nIf a script, spreadsheet or dashboard uses it, create a replacement in Settings -> API tokens before then. The old token stops working on its expiry date.\n\nIf you no longer need it, you can revoke it now in the same place.`,
  },
  es: {
    body: (name: string, tokenName: string, expiresOn: string, brand: string) =>
      `Hola ${name},<p>El token de API <strong>${tokenName}</strong> que creaste en ${brand} caduca el ${expiresOn}.</p><p>Si un script, una hoja de cálculo o un panel lo usa, crea uno nuevo en Configuración → Tokens de API antes de esa fecha. El token antiguo deja de funcionar el día que caduca.</p><p>Si ya no lo necesitas, puedes revocarlo ahora en el mismo sitio.</p>`,
    subject: (brand: string) => `Tu token de API de ${brand} caduca pronto`,
    text: (name: string, tokenName: string, expiresOn: string, brand: string) =>
      `Hola ${name},\n\nEl token de API "${tokenName}" que creaste en ${brand} caduca el ${expiresOn}.\n\nSi un script, una hoja de cálculo o un panel lo usa, crea uno nuevo en Configuración -> Tokens de API antes de esa fecha. El token antiguo deja de funcionar el día que caduca.\n\nSi ya no lo necesitas, puedes revocarlo ahora en el mismo sitio.`,
  },
  pt: {
    body: (name: string, tokenName: string, expiresOn: string, brand: string) =>
      `Olá ${name},<p>O token de API <strong>${tokenName}</strong> que criaste na ${brand} expira a ${expiresOn}.</p><p>Se um script, folha de cálculo ou dashboard o utiliza, cria um substituto em Definições → Tokens de API antes dessa data. O token antigo deixa de funcionar no dia em que expira.</p><p>Se já não precisas dele, podes revogá-lo agora no mesmo sítio.</p>`,
    subject: (brand: string) => `O teu token de API da ${brand} expira em breve`,
    text: (name: string, tokenName: string, expiresOn: string, brand: string) =>
      `Olá ${name},\n\nO token de API "${tokenName}" que criaste na ${brand} expira a ${expiresOn}.\n\nSe um script, folha de cálculo ou dashboard o utiliza, cria um substituto em Definições -> Tokens de API antes dessa data. O token antigo deixa de funcionar no dia em que expira.\n\nSe já não precisas dele, podes revogá-lo agora no mesmo sítio.`,
  },
} as const;

/** Seven-day warning that a personal API token is about to expire. */
export function sendApiTokenExpiryEmail(
  to: { email: string; name?: string },
  data: { expiresAt: Date; language: LANGUAGE; tokenName: string },
) {
  const brand = instanceName();
  const copy = API_TOKEN_EXPIRY_COPY[copyLang(data.language)];
  const name = to.name ?? to.email.split('@')[0] ?? '';
  const tokenName = escapeHtml(data.tokenName);
  const expiresOn = data.expiresAt.toISOString().slice(0, 10);
  return sendRenderedEmail({
    headers: {},
    html: copy.body(escapeHtml(name), tokenName, expiresOn, escapeHtml(brand)),
    subject: copy.subject(brand),
    text: copy.text(name, data.tokenName, expiresOn, brand),
    to,
  });
}

export function sendPasswordResetEmail(to: { email: string; name?: string }, resetUrl: string) {
  const name = to.name ?? to.email.split('@')[0] ?? '';
  const brand = instanceName();
  return sendRenderedEmail({
    headers: {},
    html: `<p>Hi ${escapeHtml(name)},</p><p>We received a request to reset your ${escapeHtml(brand)} password. Click the link below to choose a new one:</p><p><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p><p>If you didn't request this, you can safely ignore this email — your password won't change.</p><p>— The ${escapeHtml(brand)} team</p>`,
    subject: `Reset your ${brand} password`,
    text: `Hi ${name},

We received a request to reset your ${brand} password. Click the link below to choose a new one:

${resetUrl}

If you didn't request this, you can safely ignore this email — your password won't change.

— The ${brand} team`,
    to,
  });
}

/**
 * Email-verification email for better-auth's `sendVerificationEmail` callback (branded,
 * in-process, plain-text, carrying the verification link).
 */
export function sendEmailVerificationEmail(to: { email: string; name?: string }, verificationUrl: string) {
  const name = to.name ?? to.email.split('@')[0] ?? '';
  const brand = instanceName();
  return sendRenderedEmail({
    headers: {},
    html: `<p>Hi ${escapeHtml(name)},</p><p>Welcome to ${escapeHtml(brand)}! Please confirm your email address by clicking the link below:</p><p><a href="${escapeHtml(verificationUrl)}">${escapeHtml(verificationUrl)}</a></p><p>If you didn't create a ${escapeHtml(brand)} account, you can safely ignore this email.</p><p>— The ${escapeHtml(brand)} team</p>`,
    subject: `Verify your ${brand} email`,
    text: `Hi ${name},

Welcome to ${brand}! Please confirm your email address by clicking the link below:

${verificationUrl}

If you didn't create a ${brand} account, you can safely ignore this email.

— The ${brand} team`,
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
  if (!LANGUAGES.includes(input.language)) {
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

  const lang = copyLang(input.language);
  const copy = BANK_RECOVERY_COPY[lang];
  const brand = instanceName();
  let rendered;
  try {
    rendered = await renderLifecycleNudgeEmail({
      body: copy.body.map((paragraph) => paragraph(brand)),
      brandName: brand,
      ctaLabel: copy.cta,
      ctaUrl: input.recoveryUrl,
      heading: copy.heading,
      language: lang,
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
    // The signal is FORWARDED, not merely checked at entry. A `Promise.race` deadline leaves its
    // loser running: the delivery would be recorded `provider_timeout` while the HTTP request was
    // still in flight and could still deliver — which, combined with a non-atomic status write, is
    // how a "timed out" email gets sent twice.
    result = await send(payload, { idempotencyKey: `${input.incidentId}:${input.templateVersion}`, ...(input.signal ? { signal: input.signal } : {}) } satisfies CreateEmailRequestOptions);
  } catch {
    return { code: 'provider_unknown', status: 'ambiguous' };
  }
  return classifyBankRecoveryResult(result);
}

/** Maps a non-Resend transport outcome onto the bank-recovery delivery states. */
export function sendSignupEmail(data: SignupData, language: LANGUAGE) {
  const subject = copyLang(language) === 'pt' ? `${instanceName()} - INTERNAL Registo de Utilizador` : `${instanceName()} - INTERNAL User Signup`;
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
      subject: `${instanceName()} - Support`,
      title: 'Support request',
      variant: 'info',
    },
  );
}

/** In-app feedback from a signed-in user, to `SUPPORT_EMAIL`. Replies go to the user. */
export function sendFeedbackEmail(data: FeedbackEmailData) {
  const typeLabel = FEEDBACK_TYPE_LABELS[data.type];
  return sendInternalAlert(
    {
      details: [
        { label: 'Type', value: typeLabel },
        ...(data.name ? [{ label: 'Name', value: data.name }] : []),
        { label: 'Email', value: data.email },
        ...(data.page ? [{ label: 'Page', value: data.page }] : []),
      ],
      intro: data.message,
      subject: `${instanceName()} - Feedback (${typeLabel})`,
      title: 'Feedback',
      variant: 'info',
    },
    { replyTo: { email: data.email, ...(data.name ? { name: data.name } : {}) } },
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
 * react-email publish (out of scope; noted in the handoff). Copy is EN, PT and ES, selected by
 * `language`. */

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
  const lang = copyLang(input.language);
  const unsubscribeUrl = accountOptOutUrl(input.appuserKey);
  const rendered = await renderLifecycleNudgeEmail({
    body: copy.body,
    brandName: instanceName(),
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
const welcomeCopy = (brand: string): Record<(typeof COPY_LOCALES)[number], TransactionalNudgeCopy> => ({
  en: {
    body: [
      'Thanks for signing up — your account is ready to go.',
      `${brand} brings your accounts, budgets and investments together in one place. Connect your first account to watch everything come to life.`,
      'Any questions? Just reply to this email — a real person reads it.',
    ],
    ctaLabel: `Open ${brand}`,
    heading: `Welcome to ${brand}`,
    preheader: 'Your account is ready — here is how to get started.',
    subject: `Welcome to ${brand} 🎉`,
  },
  es: {
    body: [
      'Gracias por registrarte: tu cuenta ya está lista.',
      `${brand} reúne tus cuentas, presupuestos e inversiones en un solo lugar. Conecta tu primera cuenta para ver cómo todo cobra vida.`,
      '¿Tienes alguna pregunta? Responde a este correo: lo lee una persona de verdad.',
    ],
    ctaLabel: `Abrir ${brand}`,
    heading: `Te damos la bienvenida a ${brand}`,
    preheader: 'Tu cuenta está lista: así puedes empezar.',
    subject: `Te damos la bienvenida a ${brand} 🎉`,
  },
  pt: {
    body: [
      'Obrigado por te registares — a tua conta está pronta.',
      `A ${brand} reúne as tuas contas, orçamentos e investimentos num só lugar. Liga a tua primeira conta para veres tudo a ganhar vida.`,
      'Alguma dúvida? Responde a este email — é uma pessoa a sério que o lê.',
    ],
    ctaLabel: `Abrir a ${brand}`,
    heading: `Bem-vindo à ${brand}`,
    preheader: 'A tua conta está pronta — começa por aqui.',
    subject: `Bem-vindo à ${brand} 🎉`,
  },
});

export function sendWelcomeEmail(input: TransactionalUserEmailInput) {
  const lang = accountLocale(input.language);
  return sendTransactionalNudge(input, welcomeCopy(instanceName())[copyLang(input.language)], {
    ctaUrl: `${appBase()}/${lang}`,
    settingsUrl: `${appBase()}/${lang}/settings`,
  });
}

/* Data export ready (trigger: the export job stored the archive). CTA → Settings > Privacy, which
 * makes a fresh download link; the email never carries the file or a link to it. */
const dataExportReadyCopy = (brand: string): Record<(typeof COPY_LOCALES)[number], TransactionalNudgeCopy> => ({
  en: {
    body: [
      `The export of your ${brand} data you asked for is ready.`,
      'Download it from Settings > Privacy within 24 hours. After that the file is deleted and you can start a new export.',
      'If you did not ask for this export, change your password and check the devices signed in to your account.',
    ],
    ctaLabel: 'Download your data',
    heading: 'Your data export is ready',
    preheader: 'Download it within 24 hours.',
    subject: `Your ${brand} data export is ready`,
  },
  es: {
    body: [
      `La exportación de tus datos de ${brand} que pediste está lista.`,
      'Descárgala en Configuración > Privacidad en las próximas 24 horas. Después, el archivo se elimina y puedes pedir una nueva exportación.',
      'Si no pediste esta exportación, cambia tu contraseña y revisa los dispositivos con sesión iniciada en tu cuenta.',
    ],
    ctaLabel: 'Descargar tus datos',
    heading: 'La exportación de tus datos está lista',
    preheader: 'Descárgala en las próximas 24 horas.',
    subject: `La exportación de tus datos de ${brand} está lista`,
  },
  pt: {
    body: [
      `A exportação dos teus dados da ${brand} que pediste está pronta.`,
      'Descarrega-a em Definições > Privacidade nas próximas 24 horas. Depois disso o ficheiro é apagado e podes pedir uma nova exportação.',
      'Se não pediste esta exportação, muda a tua palavra-passe e verifica os dispositivos com sessão iniciada na tua conta.',
    ],
    ctaLabel: 'Descarregar os teus dados',
    heading: 'A exportação dos teus dados está pronta',
    preheader: 'Descarrega-a nas próximas 24 horas.',
    subject: `A exportação dos teus dados da ${brand} está pronta`,
  },
});

export function sendDataExportReadyEmail(input: TransactionalUserEmailInput) {
  const lang = accountLocale(input.language);
  return sendTransactionalNudge(input, dataExportReadyCopy(instanceName())[copyLang(input.language)], {
    ctaUrl: `${appBase()}/${lang}/settings?tab=privacy`,
    settingsUrl: `${appBase()}/${lang}/settings?tab=privacy`,
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

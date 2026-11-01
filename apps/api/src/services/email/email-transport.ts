import { randomUUID } from 'node:crypto';

import nodemailer, { type Transporter } from 'nodemailer';

import { instanceName } from '@config/instance-name';
import logger from '@utils/logger';

/**
 * How the API delivers email, from the environment:
 *
 * - `resend` wherever `RESEND_API_KEY` is set: the hosted instance, unchanged.
 * - `smtp` when `SMTP_HOST` is set (`SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`).
 * - `log` otherwise: the whole message, links included, goes to the log. A single-user install
 *   can still reset a password or accept an invite by reading the link from the API logs.
 *
 * `EMAIL_DRIVER` overrides the inference.
 */
export type EmailDriver = 'log' | 'resend' | 'smtp';

export type EmailOutcome =
  | { errorCode?: string; retryable: boolean; type: 'rejected' }
  | { providerMessageIds: string[]; type: 'accepted' }
  | { type: 'intercepted' }
  | { type: 'unknown' };

export interface OutgoingEmail {
  attachments?: { content: string; contentType: string; filename: string }[];
  /** `Name <address>` or a bare address. */
  from: string;
  headers?: Record<string, string>;
  html: string;
  replyTo?: string;
  subject: string;
  text: string;
  to: string;
}

type Env = Readonly<Record<string, string | undefined>>;

const read = (env: Env, key: string): null | string => env[key]?.trim() || null;

export function resolveEmailDriver(env: Env = process.env): EmailDriver {
  const explicit = read(env, 'EMAIL_DRIVER');
  if (explicit === 'log' || explicit === 'resend' || explicit === 'smtp') return explicit;
  if (read(env, 'RESEND_API_KEY')) return 'resend';
  if (read(env, 'SMTP_HOST')) return 'smtp';
  return 'log';
}

/**
 * The product's sender: `EMAIL_FROM`/`EMAIL_FROM_NAME`. The name defaults to the instance's own
 * (`INSTANCE_NAME`), so a self-hosted instance's mail does not arrive from "WonderMoney".
 *
 * `RESEND_FROM_EMAIL`/`RESEND_FROM_NAME` are deprecated aliases, read only as fallbacks because
 * the hosted instance still sets them. Drop them once its environment uses the canonical names.
 */
export function emailSender(env: Env = process.env): { email: string; name: string } {
  const email = read(env, 'EMAIL_FROM') ?? read(env, 'RESEND_FROM_EMAIL') ?? 'wondermoney@localhost';
  const name = read(env, 'EMAIL_FROM_NAME') ?? read(env, 'RESEND_FROM_NAME') ?? instanceName(env);
  return { email, name };
}

/**
 * The team inbox internal alerts (support requests, account deletions, signups) go to. `null`
 * when unset: those alerts are then logged rather than sent, because there is nobody to send
 * them to.
 */
export function supportInbox(env: Env = process.env): null | string {
  return read(env, 'SUPPORT_EMAIL');
}

/**
 * Where in-app feedback is delivered: `SUPPORT_EMAIL`, but only when an email provider is
 * configured. With the `log` driver the message would only reach the API log, which nobody is
 * told to read, so the feedback form is not offered at all.
 */
export function feedbackInbox(env: Env = process.env): null | string {
  return resolveEmailDriver(env) === 'log' ? null : supportInbox(env);
}

/** Sends through the `log` or `smtp` driver. Resend has its own path in `services/email.ts`. */
export async function sendWithTransport(message: OutgoingEmail, options: { signal?: AbortSignal } = {}, env: Env = process.env): Promise<EmailOutcome> {
  if (resolveEmailDriver(env) === 'smtp') return sendViaSmtp(message, options, env);
  return sendViaLog(message);
}

function sendViaLog(message: OutgoingEmail): EmailOutcome {
  const id = `log-${randomUUID()}`;
  logger.info(
    { email: { from: message.from, headers: message.headers, id, subject: message.subject, text: message.text, to: message.to } },
    'Email not sent: no email provider is configured (EMAIL_DRIVER=log). Its full text is logged here.',
  );
  return { providerMessageIds: [id], type: 'accepted' };
}

let smtpTransport: Transporter | undefined;
let smtpTransportKey: string | undefined;

function getSmtpTransport(env: Env): Transporter {
  const host = read(env, 'SMTP_HOST') ?? 'localhost';
  const port = Number(read(env, 'SMTP_PORT') ?? '587');
  const user = read(env, 'SMTP_USER');
  const pass = env['SMTP_PASSWORD'] ?? '';
  // Implicit TLS on 465, STARTTLS (negotiated by nodemailer) everywhere else, unless overridden.
  const secureFlag = read(env, 'SMTP_SECURE');
  const secure = secureFlag === null ? port === 465 : ['1', 'on', 'true', 'yes'].includes(secureFlag);
  const key = JSON.stringify([host, port, user, pass, secure]);
  if (!smtpTransport || smtpTransportKey !== key) {
    smtpTransport = nodemailer.createTransport({
      host,
      port,
      secure,
      ...(user ? { auth: { pass, user } } : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    smtpTransportKey = key;
  }
  return smtpTransport;
}

async function sendViaSmtp(message: OutgoingEmail, options: { signal?: AbortSignal }, env: Env): Promise<EmailOutcome> {
  if (options.signal?.aborted) return { type: 'unknown' };
  try {
    const info = await getSmtpTransport(env).sendMail({
      ...(message.attachments?.length ? { attachments: message.attachments.map((a) => ({ content: a.content, contentType: a.contentType, encoding: 'base64', filename: a.filename })) } : {}),
      from: message.from,
      ...(message.headers ? { headers: message.headers } : {}),
      html: message.html,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      subject: message.subject,
      text: message.text,
      to: message.to,
    });
    return { providerMessageIds: [info.messageId], type: 'accepted' };
  } catch (error) {
    return classifySmtpError(error);
  }
}

/**
 * An SMTP reply code says whether the server took responsibility: 4xx is a temporary refusal
 * worth retrying, 5xx a permanent one. Failing to connect at all means nothing was sent, so it is
 * retryable too. Anything else (a timeout mid-transfer) leaves delivery unknowable.
 */
function classifySmtpError(error: unknown): EmailOutcome {
  const { code, responseCode } = (error ?? {}) as { code?: string; responseCode?: number };
  if (typeof responseCode === 'number' && responseCode >= 500) return { errorCode: `smtp_${responseCode}`, retryable: false, type: 'rejected' };
  if (typeof responseCode === 'number' && responseCode >= 400) return { errorCode: `smtp_${responseCode}`, retryable: true, type: 'rejected' };
  if (code === 'ECONNECTION' || code === 'EDNS' || code === 'ESOCKET') return { errorCode: code.toLowerCase(), retryable: true, type: 'rejected' };
  return { type: 'unknown' };
}

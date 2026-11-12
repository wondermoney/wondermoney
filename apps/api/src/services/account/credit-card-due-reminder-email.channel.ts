import { renderCreditCardDueReminderEmail } from '@wondermoney/react-email';

import { instanceName } from '@config/instance-name';
import { SupportedLanguages } from '@entity/Appuser';
import { type RenderedEmailInput, type RenderedEmailOutcome, sendRenderedEmail } from '@service/email/email';
import { EmailGlobalOptOutService } from '@service/email/email-global-opt-out.service';
import { categoryEnabled, EmailCategory, isRecipientReachable } from '@service/email/email-preferences';
import { isEmailConfigured } from '@service/email/email-transport';
import { BACKEND_URL, FRONTEND_URL } from '@utils/constants';

import type { CreditCardDueReminderChannelHandler, CreditCardDueReminderChannelOutcome, CreditCardDueReminderMessage } from './credit-card-due-reminder.service';

interface EmailChannelDependencies {
  /** Whether a real provider is configured; the log driver is not an inbox. */
  isEmailConfigured?: () => boolean;
  optOut?: Pick<EmailGlobalOptOutService, 'generateCategoryToken'>;
  send?: (input: RenderedEmailInput) => Promise<RenderedEmailOutcome>;
}

const trimSlash = (url: string) => url.replace(/\/$/u, '');

/**
 * Payment-due reminders by email, in the owner's language (EN or PT, the languages emails support).
 * Optional mail: the credit-card-due-reminders category and the account-wide unsubscribe both stop
 * it, and every message carries a one-click unsubscribe for its category. With no email provider
 * configured (`EMAIL_DRIVER=log` or nothing set) the channel is unavailable and nothing is sent: a
 * reminder written to the API log is not a reminder.
 */
export function createCreditCardDueReminderEmailChannel(dependencies: EmailChannelDependencies = {}): CreditCardDueReminderChannelHandler {
  const send = dependencies.send ?? sendRenderedEmail;
  const optOut = dependencies.optOut ?? new EmailGlobalOptOutService();
  const configured = dependencies.isEmailConfigured ?? (() => isEmailConfigured());

  return {
    available: configured,
    async deliver(message: CreditCardDueReminderMessage): Promise<CreditCardDueReminderChannelOutcome> {
      const lang = message.recipient.language === SupportedLanguages.PT ? 'pt' : 'en';
      const intlLocale = lang === 'pt' ? 'pt-PT' : 'en-GB';
      const app = trimSlash(FRONTEND_URL);
      const formatDate = (value: string) => new Intl.DateTimeFormat(intlLocale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00.000Z`));
      const rendered = await renderCreditCardDueReminderEmail({
        accountName: message.accountName?.trim() || (lang === 'pt' ? 'cartão' : 'card'),
        amountDue: new Intl.NumberFormat(intlLocale, { currency: message.currencyCode, currencyDisplay: 'symbol', style: 'currency' }).format(message.amountDue),
        brandName: instanceName(),
        daysUntilDue: message.daysUntilDue,
        dueDate: formatDate(message.dueDate),
        firstName: message.recipient.firstName ?? undefined,
        language: lang,
        periodLabel: `${formatDate(message.periodStart)} – ${formatDate(message.periodEnd)}`,
        settingsUrl: `${app}/${lang}/settings?tab=notifications`,
        statementUrl: `${app}/${lang}/accounts/${message.accountKey}?tab=statements`,
      });
      const token = optOut.generateCategoryToken(message.recipient.appuserKey, EmailCategory.CREDIT_CARD_DUE_REMINDERS);
      const unsubscribeUrl = `${trimSlash(BACKEND_URL)}/v1/marketing/email-opt-out?token=${encodeURIComponent(token)}`;
      const outcome = await send({
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        html: rendered.html,
        idempotencyKey: `credit-card-due-reminder-${message.accountKey}-${message.periodEnd}`,
        preheader: rendered.preheader,
        subject: rendered.subject,
        text: rendered.text,
        to: { email: message.recipient.emailAddress, name: message.recipient.firstName ?? undefined },
      });
      switch (outcome.type) {
        case 'accepted':
          return { providerMessageId: outcome.providerMessageIds[0], type: 'delivered' };
        case 'intercepted':
          return { type: 'delivered' };
        case 'rejected':
          return { code: safeCode(outcome.errorCode), type: outcome.retryable ? 'retryable' : 'failed' };
        case 'unknown':
          return { code: 'provider_unknown', type: 'unknown' };
      }
    },
    gate(recipient, preference) {
      if (!isRecipientReachable(recipient)) return 'recipient_unreachable';
      if (recipient.marketingOptOut) return 'marketing_opt_out';
      if (!categoryEnabled(preference, EmailCategory.CREDIT_CARD_DUE_REMINDERS)) return 'credit_card_due_reminders_disabled';
      return undefined;
    },
  };
}

function safeCode(code: string | undefined): string {
  const normalized = (code ?? 'rejected').toLowerCase().replace(/[^a-z0-9_]/gu, '_').slice(0, 48);
  return `provider_${normalized}`;
}

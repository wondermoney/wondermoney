import { renderBankSyncAlertEmail } from '@wondermoney/react-email';

import { FINANCIAL_EMAIL_TIME_ZONE } from '@app/jobs/financial-emails.queue';
import { instanceName } from '@config/instance-name';
import { type RenderedEmailInput, type RenderedEmailOutcome, sendRenderedEmail } from '@service/email/email';
import { EmailGlobalOptOutService } from '@service/email/email-global-opt-out.service';
import { categoryEnabled, EmailCategory, isRecipientReachable } from '@service/email/email-preferences';
import { accountLocale, copyLocale, INTL_LOCALE } from '@utils/account-language';
import { BACKEND_URL, FRONTEND_URL } from '@utils/constants';

import type { BankSyncAlertChannelHandler, BankSyncAlertChannelOutcome, BankSyncAlertMessage } from './bank-sync-alert-channel';

interface EmailChannelDependencies {
  optOut?: Pick<EmailGlobalOptOutService, 'generateCategoryToken'>;
  send?: (input: RenderedEmailInput) => Promise<RenderedEmailOutcome>;
}

const trimSlash = (url: string) => url.replace(/\/$/u, '');

/**
 * Bank sync alerts by email, in the owner's language: EN, PT or ES, the languages this template is
 * written in. Any other account language reads English, with links that open the app in its own
 * locale.
 * Optional mail: the bank-sync-alerts category and the account-wide unsubscribe both stop it, and
 * every message carries a one-click unsubscribe for its category.
 */
export function createBankSyncAlertEmailChannel(dependencies: EmailChannelDependencies = {}): BankSyncAlertChannelHandler {
  const send = dependencies.send ?? sendRenderedEmail;
  const optOut = dependencies.optOut ?? new EmailGlobalOptOutService();

  return {
    async deliver(message: BankSyncAlertMessage): Promise<BankSyncAlertChannelOutcome> {
      const lang = copyLocale(message.recipient.language, ['en', 'pt', 'es']);
      const link = accountLocale(message.recipient.language);
      const date = (value: Date | null) => (value
        ? new Intl.DateTimeFormat(INTL_LOCALE[lang], { day: 'numeric', month: 'long', timeZone: FINANCIAL_EMAIL_TIME_ZONE }).format(value)
        : undefined);
      const app = trimSlash(FRONTEND_URL);
      const rendered = await renderBankSyncAlertEmail({
        bankName: message.bankName,
        brandName: instanceName(),
        expiryDate: date(message.accessValidUntil),
        failingSinceDate: date(message.failingSince),
        firstName: message.recipient.firstName ?? undefined,
        kind: message.event,
        language: lang,
        reconnectUrl: `${app}/${link}/settings?tab=connections`,
        settingsUrl: `${app}/${link}/settings?tab=notifications`,
      });
      const token = optOut.generateCategoryToken(message.recipient.appuserKey, EmailCategory.BANK_SYNC_ALERTS);
      const unsubscribeUrl = `${trimSlash(BACKEND_URL)}/v1/marketing/email-opt-out?token=${encodeURIComponent(token)}`;
      const outcome = await send({
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        html: rendered.html,
        idempotencyKey: message.deliveryId,
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
      if (!categoryEnabled(preference, EmailCategory.BANK_SYNC_ALERTS)) return 'bank_sync_alerts_disabled';
      return undefined;
    },
  };
}

function safeCode(code: string | undefined): string {
  const normalized = (code ?? 'rejected').toLowerCase().replace(/[^a-z0-9_]/gu, '_').slice(0, 48);
  return `provider_${normalized}`;
}

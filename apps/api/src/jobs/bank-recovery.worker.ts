import type { JobWithMetadata } from 'pg-boss';
import type { Logger } from 'pino';

import { DI } from '@app/database/di';
import { parseBankRecoveryPayload } from '@app/jobs/bank-recovery.queue';
import { AccountFinancialInstitution } from '@entity/AccountFinancialInstitution';
import { SupportedLanguages } from '@entity/Appuser';
import { type BankRecoveryProviderOutcome, BankRecoveryService } from '@service/bank-sync/bank-recovery.service';
import { type BankRecoveryEmailOutcome, sendBankRecoveryEmail } from '@service/email/email';
import { EmailGlobalOptOutService } from '@service/email/email-global-opt-out.service';
import { EmailCategory } from '@service/email/email-preferences';
import { BACKEND_URL, FRONTEND_URL } from '@utils/constants';
import logger from '@utils/logger';

const CLAIM_LEASE_MS = 5 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 20_000;

interface BankRecoveryWorkerDependencies {
  bankRecoveryService?: Pick<BankRecoveryService, 'claim' | 'sendClaim'>;
  env?: NodeJS.ProcessEnv;
  logger?: Pick<Logger, 'info' | 'warn'>;
  optOutService?: Pick<EmailGlobalOptOutService, 'generateCategoryToken'>;
  sendEmail?: typeof sendBankRecoveryEmail;
}

export async function handleBankRecoveryJob(
  job: JobWithMetadata<unknown>,
  dependencies: BankRecoveryWorkerDependencies = {},
): Promise<boolean> {
  const log = dependencies.logger ?? logger;
  let payload;
  try {
    payload = parseBankRecoveryPayload(job.data);
  } catch {
    log.warn({ jobId: job.id, queue: 'bank-recovery.send' }, 'Bank recovery job payload is invalid');
    return false;
  }

  const service = dependencies.bankRecoveryService ?? new BankRecoveryService({ em: DI.em, env: dependencies.env });
  let claim;
  try {
    claim = await service.claim(payload.deliveryKey, job.id, CLAIM_LEASE_MS);
  } catch {
    log.warn({ deliveryKey: payload.deliveryKey, jobId: job.id }, 'Bank recovery claim failed safely');
    return false;
  }
  if (!claim) return false;
  if (claim.incident.incidentId !== payload.incidentId || claim.delivery.templateVersion !== payload.templateVersion) {
    log.warn({ deliveryKey: payload.deliveryKey, jobId: job.id }, 'Bank recovery delivery does not match payload');
    return false;
  }

  const optOutService = dependencies.optOutService ?? new EmailGlobalOptOutService();
  const bankName = claim.incident.institutionId
    ? (await DI.em.findOne(AccountFinancialInstitution, { id: claim.incident.institutionId }))?.displayName
    : undefined;
  let result;
  try {
    result = await service.sendClaim({
      claimToken: claim.claimToken,
      deliveryKey: payload.deliveryKey,
      send: async ({ appuser, signal }) => {
        const language = appuser.language === SupportedLanguages.PT ? 'PT' : 'EN';
        const unsubscribeToken = optOutService.generateCategoryToken(appuser.appuserKey, EmailCategory.ACCOUNT_RECOVERY);
        const emailOutcome = await (dependencies.sendEmail ?? sendBankRecoveryEmail)({
          bankName,
          incidentId: payload.incidentId,
          language,
          recipient: appuser.emailAddress,
          recoveryUrl: `${FRONTEND_URL.replace(/\/$/, '')}/${language.toLowerCase()}/accounts`,
          signal,
          templateVersion: payload.templateVersion,
          unsubscribeUrl: `${backendBaseUrl()}/v1/marketing/email-opt-out?token=${encodeURIComponent(unsubscribeToken)}`,
        });
        return providerOutcome(emailOutcome);
      },
      timeoutMs: PROVIDER_TIMEOUT_MS,
    });
  } catch {
    log.warn({ deliveryKey: payload.deliveryKey, jobId: job.id }, 'Bank recovery send was resolved without queue retry');
    return false;
  }

  if (result.shouldRetry) throw new Error('Bank recovery provider failed before acceptance');
  log.info({ authorized: result.authorized, deliveryKey: payload.deliveryKey, jobId: job.id }, 'Bank recovery job resolved');
  return true;
}

function backendBaseUrl(): string {
  return BACKEND_URL.replace(/\/$/u, '');
}

function providerOutcome(outcome: BankRecoveryEmailOutcome): BankRecoveryProviderOutcome {
  if ('messageId' in outcome) return { messageId: outcome.messageId, type: 'accepted' };
  return { code: outcome.code, type: outcome.status };
}

import type { EntityManager } from '@mikro-orm/core';
import * as Sentry from '@sentry/node';

import { DI } from '@app/database/di';
import { AppuserTenant } from '@entity/AppuserTenant';
import { AssistantConsent } from '@entity/AssistantConsent';
import { EmailNotificationPreference } from '@entity/EmailNotificationPreference';
import { NordigenRequisition } from '@entity/NordigenRequisition';
import { SentEmail } from '@entity/SentEmail';
import logger from '@utils/logger';

import { tearDownHouseholdOnOwnerDeletion } from '../household/household-membership.service';

interface Account {
  appuserKey: number;
  deletedAt?: Date;
  emailAddress: string;
  externalUserId: string;
  firstName?: string;
  lastName?: string;
  marketingOptIn?: Date | null;
  marketingOptOut?: Date | null;
  mobileNumber?: null | string;
  mobileNumberPrefix?: null | string;
  recordActive: boolean;
}

interface AccountDeletedEmailData {
  appuserKey: number;
  deletedAt: Date;
  userEmail: string;
}

type AccountDeletedEmailSender = (data: AccountDeletedEmailData) => Promise<unknown> | void;

interface Deps {
  adminEmail?: AccountDeletedEmailSender;
  authAdmin?: { deleteUser: (userId: string) => Promise<void> };
  now?: Date;
  sentry?: { captureException: (error: unknown) => void };
}

export async function deleteWonderMoneyAccount(appuser: Account, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  const adminEmail = deps.adminEmail ?? (async (data: AccountDeletedEmailData) => {
    const { sendAccountDeletedEmail } = await import('../email/email');
    return sendAccountDeletedEmail(data);
  });
  const sentry = deps.sentry ?? Sentry;
  const authAdmin = deps.authAdmin ?? {
    deleteUser: async (userId: string) => {
      const { deleteBetterAuthUser } = await import('@service/auth/better-auth');
      return deleteBetterAuthUser(userId);
    },
  };

  const requisitions: NordigenRequisition[] = [];
  const assistantConsents: AssistantConsent[] = [];
  const sentEmails: SentEmail[] = [];

  const externalUserId = appuser.externalUserId;
  const originalEmailAddress = appuser.emailAddress;

  await DI.em.transactional(async (txEm: EntityManager) => {
    await txEm.getConnection().execute('select "appuser_key" from "appuser" where "appuser_key" = ? for update', [appuser.appuserKey], 'get');
    const tenantMemberships = await txEm.find(AppuserTenant, { appuserKey: appuser });
    const foundRequisitions = await txEm.find(NordigenRequisition, { appuserKey: appuser });
    const foundAssistantConsents = await txEm.find(AssistantConsent, { appuserKey: appuser });
    await txEm.nativeDelete(EmailNotificationPreference, { appuserKey: appuser });
    const foundSentEmails = await txEm.find(SentEmail, {
      $or: [
        { status: { $in: ['sending', 'failed', 'unknown'] } },
        { emailType: { $like: 'ba:%' } },
        { emailType: { $like: 'wi:%' } },
      ],
      appuser,
    });

    requisitions.push(...foundRequisitions);
    assistantConsents.push(...foundAssistantConsents);
    sentEmails.push(...foundSentEmails);

    await tearDownHouseholdOnOwnerDeletion(txEm, appuser.appuserKey, now);
    appuser.deletedAt = now;
    appuser.emailAddress = `deleted+${appuser.appuserKey}@deleted.invalid`;
    appuser.externalUserId = `deleted:${appuser.appuserKey}`;
    appuser.firstName = 'Deleted';
    appuser.mobileNumber = null;
    appuser.mobileNumberPrefix = null;
    appuser.marketingOptIn = null;
    appuser.marketingOptOut = now;
    appuser.recordActive = false;
    appuser.lastName = 'User';

    for (const membership of tenantMemberships) {
      membership.deletedAt = now;
      membership.recordActive = false;
    }
    for (const requisition of foundRequisitions) requisition.deletedAt = now;
    for (const consent of foundAssistantConsents) {
      consent.assistantEnabled = false;
      consent.disabledAt = now;
      consent.deletedAt = now;
    }
    for (const email of foundSentEmails) {
      if (typeof email.emailType === 'string' && (email.emailType.startsWith('ba:') || email.emailType.startsWith('wi:'))) {
        email.errorMessage = undefined;
        email.metadata = undefined;
        email.providerMessageIds = undefined;
        email.providerOutcome = undefined;
        email.providerRequestStartedAt = undefined;
        email.retryable = false;
        email.terminalReason = undefined;
      }
      email.deletedAt = now;
    }

    await txEm.flush();
  });

  if (externalUserId) {
    await bestEffort(() => authAdmin.deleteUser(externalUserId), 'Failed to delete better-auth user', sentry);
  }

  await bestEffort(
    () =>
      adminEmail({
        appuserKey: appuser.appuserKey,
        deletedAt: now,
        userEmail: originalEmailAddress,
      }),
    'Failed to send account deleted admin email',
    sentry,
  );
}

async function bestEffort(fn: () => Promise<unknown> | void, errorLabel: string, sentry: { captureException: (error: unknown) => void }) {
  try {
    await fn();
  } catch (error) {
    logger.error({ error }, errorLabel);
    sentry.captureException(error);
  }
}

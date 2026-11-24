import { z } from 'zod';

import { DI } from '@app/database/di';
import { AnalyticsOutbox } from '@entity/AnalyticsOutbox';
import { Appuser, AppuserAccountType, SupportedLanguages } from '@entity/Appuser';
import { assertAnalyticsOutboxEvent, isAnalyticsOutboxEnabled } from '@service/analytics/analytics-outbox.service';
import { analyticsSignInMethod } from '@service/analytics/service-events.service';
import { claimFirstAccount } from '@service/auth/instance-admin.service';
import { ERROR } from '@utils/constants';
import logger from '@utils/logger';

const SIGNUP_EVENT_ID_PREFIX = 'signup.v1:';
const externalUserIdSchema = z.guid().brand<'ExternalUserId'>();

export type SignupRecordInput = Readonly<{
  /**
   * Whether the identity provider put this person in an admin group, when its groups decide
   * (`OIDC_ADMIN_GROUPS`; `signupAdminFromGroups`). Null or absent when they don't: the first
   * account on the instance is then its admin, and every later one is a regular account.
   */
  admin?: boolean | null;
  email: string;
  externalUserId: string;
  firstName?: string;
  /** The landing tool or list route id the signup came from, sent only with analytics consent. */
  landingSource?: string;
  language?: SupportedLanguages;
  lastName?: string;
  method: string;
}>;

export type SignupRecordResult = Readonly<{
  appuser: Appuser;
  created: boolean;
}>;

/**
 * Creates the appuser for a new better-auth identity, idempotently.
 *
 * A replayed callback for an identity that already has an appuser returns it with
 * `created: false`. Two simultaneous callbacks for the same identity both succeed: the loser's
 * flush hits the unique external-id constraint, and it re-reads the winner's row.
 *
 * The `signup` analytics event commits in the same transaction, so it exists exactly when the
 * appuser does (and only while analytics delivery is on). It carries no email or name; its
 * `landing_source` is the landing page the signup came from, when the visitor consented.
 */
export async function recordSignup(input: SignupRecordInput): Promise<SignupRecordResult> {
  const externalUserId = externalUserIdSchema.parse(input.externalUserId);

  try {
    return await DI.em.transactional(async (em) => {
      const appuserRepository = em.getRepository(Appuser);
      const existingAppuser = await appuserRepository.getUserByExternalId(externalUserId);
      if (existingAppuser) return { appuser: existingAppuser, created: false };

      // The identity provider's groups decide when they are set; otherwise the first account on
      // the instance is its admin (instance-admin.service.ts).
      const admin = input.admin ?? await claimFirstAccount(em);
      const appuser = await appuserRepository.createUser({
        accountType: admin ? AppuserAccountType.ADMIN : AppuserAccountType.REGULAR,
        email: input.email,
        externalUserId,
        firstName: input.firstName,
        language: input.language ?? SupportedLanguages.EN,
        lastName: input.lastName,
        receiveUpdates: false,
      });
      const eventId = `${SIGNUP_EVENT_ID_PREFIX}${externalUserId}`;
      const properties = {
        ...(input.landingSource ? { landing_source: input.landingSource } : {}),
        locale: appuser.language,
        method: analyticsSignInMethod(input.method),
      };
      if (isAnalyticsOutboxEnabled() && isValidSignupEvent(externalUserId, eventId, properties)) {
        const outbox = new AnalyticsOutbox();
        outbox.distinctId = externalUserId;
        outbox.eventId = eventId;
        outbox.eventName = 'signup';
        outbox.properties = { ...properties, $insert_id: eventId };
        em.persist(outbox);
      }
      await em.flush();

      return { appuser, created: true };
    });
  } catch (error) {
    const uniqueViolation = z.object({ code: z.literal(ERROR.DB.DUPLICATE_RECORD_CODE) }).safeParse(error);
    if (!uniqueViolation.success) throw error;

    const winner = await DI.em.transactional((em) => em.getRepository(Appuser).getUserByExternalId(externalUserId));
    if (!winner) throw error;
    return { appuser: winner, created: false };
  }
}

/** A signup event the catalogue would refuse is dropped, never the signup. */
function isValidSignupEvent(distinctId: string, eventId: string, properties: Record<string, unknown>): boolean {
  try {
    assertAnalyticsOutboxEvent({ distinctId, eventId, eventName: 'signup', properties });
    return true;
  } catch (error) { // no-excuse-ok: catch -- analytics must never fail the signup
    logger.warn({ error }, 'Signup analytics event not recorded');
    return false;
  }
}

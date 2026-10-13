import { z } from 'zod';

import { DI } from '@app/database/di';
import { AnalyticsOutbox } from '@entity/AnalyticsOutbox';
import { Appuser, SupportedLanguages } from '@entity/Appuser';
import { ERROR } from '@utils/constants';

const SIGNUP_EVENT_ID_PREFIX = 'signup.v1:';
const externalUserIdSchema = z.string().uuid().brand<'ExternalUserId'>();

export type SignupRecordInput = Readonly<{
  email: string;
  externalUserId: string;
  firstName?: string;
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
 * appuser does. It carries no email or name.
 */
export async function recordSignup(input: SignupRecordInput): Promise<SignupRecordResult> {
  const externalUserId = externalUserIdSchema.parse(input.externalUserId);

  try {
    return await DI.em.transactional(async (em) => {
      const appuserRepository = em.getRepository(Appuser);
      const existingAppuser = await appuserRepository.getUserByExternalId(externalUserId);
      if (existingAppuser) return { appuser: existingAppuser, created: false };

      const appuser = await appuserRepository.createUser({
        email: input.email,
        externalUserId,
        firstName: input.firstName,
        language: input.language ?? SupportedLanguages.EN,
        lastName: input.lastName,
        receiveUpdates: false,
      });
      const eventId = `${SIGNUP_EVENT_ID_PREFIX}${externalUserId}`;
      const outbox = new AnalyticsOutbox();
      outbox.distinctId = externalUserId;
      outbox.eventId = eventId;
      outbox.eventName = 'signup';
      outbox.properties = {
        $insert_id: eventId,
        appuser_key: appuser.appuserKey.toString(),
        locale: appuser.language,
        method: input.method,
      };
      em.persist(outbox);
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

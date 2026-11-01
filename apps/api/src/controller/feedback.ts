import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { authedUser } from '@middleware/authed-context';
import { sendFeedbackEmail } from '@service/email/email';
import { feedbackInbox } from '@service/email/email-transport';
import { BadGatewayError, FeatureDisabledError } from '@utils/errors';
import { submitFeedbackRequestSchema } from '@validators/feedback';
import { zParse } from '@validators/parser';

/**
 * In-app feedback from a signed-in user, emailed to `SUPPORT_EMAIL`. Offered only when the
 * instance can actually send that email (`features.feedback` on `/v1/instance`), and it answers
 * 204 only once the email provider has accepted the message: anything else is an error, so the
 * client never thanks the user for feedback that went nowhere.
 */
export async function submitFeedback(req: Request, res: Response) {
  const {
    body: { message, page, type },
  } = await zParse(submitFeedbackRequestSchema, req);

  if (!feedbackInbox()) throw new FeatureDisabledError('Feedback');

  const user = authedUser(req);
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  const outcome = await sendFeedbackEmail({
    email: user.emailAddress,
    message,
    type,
    ...(name ? { name } : {}),
    ...(page ? { page } : {}),
  });

  if (outcome.type !== 'accepted') throw new BadGatewayError(`Feedback was not delivered (${outcome.type})`);
  return res.sendStatus(StatusCodes.NO_CONTENT);
}

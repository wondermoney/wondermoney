import type { Request, Response } from 'express';

import { zParse } from '@app/validators/parser';
import { authedUser } from '@middleware/authed-context';
import { emailGlobalOptOutService } from '@service/email/email-global-opt-out.service';
import { emailNotificationPreferenceService } from '@service/email/email-notification-preference.service';
import { emailGlobalOptOutPostSchema, emailGlobalOptOutQuerySchema, patchEmailNotificationPreferencesSchema } from '@validators/email-notifications';

export async function applyGlobalEmailOptOut(req: Request, res: Response) {
  setOptOutPrivacyHeaders(res);
  const { query } = await zParse(emailGlobalOptOutPostSchema, req);
  await emailGlobalOptOutService.applyGlobalOptOut(query.token);
  return res.sendStatus(204);
}

export async function getEmailNotificationPreferences(req: Request, res: Response) {
  const user = authedUser(req);
  return res.json(await emailNotificationPreferenceService.getForAppuser(user.appuserKey));
}

export async function inspectGlobalEmailOptOut(req: Request, res: Response) {
  setOptOutPrivacyHeaders(res);
  const { query } = await zParse(emailGlobalOptOutQuerySchema, req);
  emailGlobalOptOutService.validateToken(query.token);
  return res.json({ action: 'confirm_global_email_opt_out' });
}

export async function patchEmailNotificationPreferences(req: Request, res: Response) {
  const user = authedUser(req);
  const { body } = await zParse(patchEmailNotificationPreferencesSchema, req);
  return res.json(await emailNotificationPreferenceService.patchForAppuser(user.appuserKey, body));
}

function setOptOutPrivacyHeaders(res: Response) {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
}

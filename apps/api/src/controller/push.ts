import type { Request, Response } from 'express';

import { zParse } from '@app/validators/parser';
import { isPushEnabled } from '@config/push';
import { authedUser } from '@middleware/authed-context';
import { pushDeviceService } from '@service/push/push-device.service';
import { queuePushNotification } from '@service/push/push-notifier';
import { pushPreferenceService } from '@service/push/push-preference.service';
import { ConflictError, FeatureDisabledError, UnauthorizedError } from '@utils/errors';
import { patchPushPreferencesSchema, registerPushDeviceSchema, unregisterPushDeviceSchema } from '@validators/push';

/** Push needs a real sign-in session: the device ends with it. A personal API token has none. */
function sessionIdOf(req: Request): string {
  const id = req.authUser?.session.id;
  if (!id || id.startsWith('api-token:')) throw new UnauthorizedError('Push devices need a signed-in session');
  return id;
}

/** `POST /v1/user/me/push-devices` — register this phone's Expo push token for the signed-in person. */
export async function registerPushDevice(req: Request, res: Response) {
  if (!isPushEnabled()) throw new FeatureDisabledError('Push notifications');
  const user = authedUser(req);
  const { body } = await zParse(registerPushDeviceSchema, req);
  await pushDeviceService.register(user.appuserKey, sessionIdOf(req), body);
  return res.sendStatus(204);
}

/**
 * `DELETE /v1/user/me/push-devices/:token` — the app calls it while signing out. Only the caller's
 * own device is removed, and the answer is the same whether there was one, so it says nothing about
 * other people's tokens. Works with push off, so a phone can always clean up.
 */
export async function unregisterPushDevice(req: Request, res: Response) {
  const user = authedUser(req);
  const { params } = await zParse(unregisterPushDeviceSchema, req);
  await pushDeviceService.unregister(user.appuserKey, params.token);
  return res.sendStatus(204);
}

/** `GET /v1/user/me/push-preferences` — the push categories, each off until turned on. */
export async function getPushPreferences(req: Request, res: Response) {
  const user = authedUser(req);
  return res.json(await pushPreferenceService.getForAppuser(user.appuserKey));
}

/** `PATCH /v1/user/me/push-preferences` — turning a category on needs push on this server. */
export async function patchPushPreferences(req: Request, res: Response) {
  const user = authedUser(req);
  const { body } = await zParse(patchPushPreferencesSchema, req);
  return res.json(await pushPreferenceService.patchForAppuser(user.appuserKey, body));
}

/** `POST /v1/user/me/push-test` — send a test notification to every phone the person registered. */
export async function sendTestPush(req: Request, res: Response) {
  const user = authedUser(req);
  const outcome = await queuePushNotification(user.appuserKey, { kind: 'test' }, { enqueue: req.enqueue });
  if (outcome === 'disabled') throw new FeatureDisabledError('Push notifications');
  if (outcome === 'no_devices') throw new ConflictError('No phone is registered for push notifications');
  return res.status(202).json({ status: 'queued' });
}

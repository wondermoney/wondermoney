import type { Request, Response } from 'express';

import { zParse } from '@app/validators/parser';
import { authedUser } from '@middleware/authed-context';
import { userPreferencesService } from '@service/preferences/user-preferences.service';
import { patchUserPreferencesSchema } from '@validators/preferences';

/** `GET /v1/user/me/preferences`: the authenticated user's own preferences. */
export async function getPreferences(req: Request, res: Response) {
  const user = authedUser(req);
  return res.json(await userPreferencesService.getForAppuser(user.appuserKey));
}

/** `PATCH /v1/user/me/preferences`: a partial update, validated per key. */
export async function patchPreferences(req: Request, res: Response) {
  const user = authedUser(req);
  const { body } = await zParse(patchUserPreferencesSchema, req);
  return res.json(await userPreferencesService.patchForAppuser(user.appuserKey, body));
}

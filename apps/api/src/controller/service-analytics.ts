import type { Request, Response } from 'express';

import { DI } from '@app/database/di';
import { zParse } from '@app/validators/parser';
import { authedUser } from '@middleware/authed-context';
import { isAnalyticsOutboxEnabled } from '@service/analytics/analytics-outbox.service';
import { putServiceAnalyticsSchema } from '@validators/service-analytics';

/**
 * The person's choice about service analytics: the pseudonymous events the API records on
 * legitimate interest (`packages/shared/lib/analytics/README.md`). `available` says whether this
 * server records any at all (`ANALYTICS_OUTBOX_MODE=live`), so a client shows the switch only
 * where it does something; `enabled` is false once the person has objected.
 */
function serviceAnalyticsView(appuser: { analyticsObjectedAt?: Date | null }) {
  return { available: isAnalyticsOutboxEnabled(), enabled: !appuser.analyticsObjectedAt };
}

/** `GET /v1/user/me/service-analytics` */
export function getServiceAnalytics(req: Request, res: Response) {
  return res.json(serviceAnalyticsView(authedUser(req)));
}

/**
 * `PUT /v1/user/me/service-analytics` with `{ enabled }`. Objecting stops every service event of
 * the person's from then on, including any still waiting in the outbox; allowing them again
 * records only what happens next.
 */
export async function putServiceAnalytics(req: Request, res: Response) {
  const user = authedUser(req);
  const { body: { enabled } } = await zParse(putServiceAnalyticsSchema, req);
  if (enabled) user.analyticsObjectedAt = null;
  else user.analyticsObjectedAt ??= new Date();
  await DI.em.persist(user).flush();
  return res.json(serviceAnalyticsView(user));
}

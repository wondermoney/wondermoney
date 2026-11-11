import type { Request, Response } from 'express';
import { z } from 'zod';

import { DI } from '@app/database/di';
import { setTenantContext } from '@app/database/filters/tenant-filter';
import { authedContext } from '@middleware/authed-context';
import {
  findActiveCalendarFeedToken,
  revokeCalendarFeedTokens,
  rotateCalendarFeedToken,
  toApiTokenDto,
} from '@service/api-token/api-token.service';
import { buildBillsCalendarFeed, CALENDAR_LOCALES } from '@service/calendar/calendar-feed.service';
import { zParse } from '@validators/parser';

/**
 * The feed token arrives in the query string because Google Calendar, Apple Calendar and most
 * other subscribers cannot send an `Authorization` header. `requireCalendarFeedToken` resolves it
 * before this handler runs; the locale only changes the event text.
 */
const calendarFeedQuerySchema = z.object({
  query: z.object({
    locale: z.enum(CALENDAR_LOCALES).optional(),
  }),
});

/** `GET /v1/calendar/bills.ics?token=…` — a read-only ICS feed of the member's upcoming bills. */
export async function getBillsCalendarFeed(req: Request, res: Response) {
  const { query } = await zParse(calendarFeedQuerySchema, req);
  const { tenant, user } = authedContext(req);

  // The token acts as its owner: the tenant filter and the private-account carve-out apply
  // exactly as they do for a signed-in request, so the feed shows only bills this member can see.
  setTenantContext(DI.em, { appuserKey: user.appuserKey, tenantKey: tenant.tenantKey });

  const calendar = await buildBillsCalendarFeed({ appuser: user, locale: query.locale, tenant });

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', 'inline; filename="wondermoney-bills.ics"');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return res.send(calendar);
}

/** `GET /v1/user/calendar-feed-token` — whether a link exists, never the link itself. */
export async function getCalendarFeedToken(req: Request, res: Response) {
  const { user } = authedContext(req);
  const token = await findActiveCalendarFeedToken(user);
  return res.json({ calendarFeedToken: token ? toApiTokenDto(token) : null });
}

/**
 * `POST /v1/user/calendar-feed-token` — issue a new link and revoke the previous one.
 *
 * A reset is the same action as the first creation: the plain token is returned once, so a
 * person who lost the link resets it rather than reading it back.
 */
export async function resetCalendarFeedToken(req: Request, res: Response) {
  const { tenant, user } = authedContext(req);
  const { apiToken, token } = await rotateCalendarFeedToken({ appuser: user, tenant });
  return res.status(201).json({ calendarFeedToken: toApiTokenDto(apiToken), token });
}

/** `DELETE /v1/user/calendar-feed-token` — revoke the link; the next fetch gets a 404. */
export async function revokeCalendarFeedToken(req: Request, res: Response) {
  const { user } = authedContext(req);
  await revokeCalendarFeedTokens(user);
  return res.sendStatus(204);
}

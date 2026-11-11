import type { Request, Response } from 'express';

import { forecastBalances } from '@service/account/balance-forecast.service';
import { InternalServerError } from '@utils/errors';
import { getAccountsForecastRequestSchema } from '@validators/account';
import { zParse } from '@validators/parser';

import { DI } from '../../app.js';

/**
 * `GET /v1/account/forecast?days=30&accountKeys=1,2`
 *
 * The projected daily balance of the caller's accounts for the next 30 to 90 days: today's
 * balance plus the recurring bills still to come. Each account stays in its own currency; the
 * household total is reported per currency, and as one figure only when every account and series
 * shares it. `accountKeys` is privacy-scoped in the service, so another member's private account
 * is absent rather than an error.
 */
export async function getAccountsForecast(req: Request, res: Response) {
  const {
    query: { accountKeys, days },
  } = await zParse(getAccountsForecastRequestSchema, req);

  if (!req.user || !req.tenant) throw new InternalServerError('Authenticated user and tenant are required');

  const forecast = await forecastBalances(DI.em, {
    accountKeys,
    days,
    tenantKey: req.tenant.tenantKey,
    viewerAppuserKey: req.user.appuserKey,
  });
  return res.json(forecast);
}

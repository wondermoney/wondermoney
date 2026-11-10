import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { authedContext } from '@middleware/authed-context';
import {
  createExchangeRateOverride,
  deleteExchangeRateOverride,
  listExchangeRateOverrides,
  updateExchangeRateOverride,
} from '@service/currency/exchange-rate-override.service';
import { createExchangeRateOverrideRequestSchema, deleteExchangeRateOverrideRequestSchema, updateExchangeRateOverrideRequestSchema } from '@validators/currency';
import { zParse } from '@validators/parser';

import { DI } from '../app';

/**
 * `GET /v1/currency/rates`: the household's exchange-rate overrides, newest day first, and the
 * member's own currency (`currency`), which their amounts convert to and so the usual target of a
 * new rate.
 */
export async function getExchangeRateOverrides(req: Request, res: Response) {
  const { tenantKey, user } = authedContext(req);
  const [overrides] = await Promise.all([listExchangeRateOverrides(DI.em, tenantKey), DI.em.populate(user, ['currencyKey'])]);
  return res.json({ currency: user.currencyKey.code, overrides });
}

/** `POST /v1/currency/rates`: add an override for a pair and day (409 when that day has one). */
export async function postExchangeRateOverride(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const { body } = await zParse(createExchangeRateOverrideRequestSchema, req);
  const override = await createExchangeRateOverride(DI.em, { appuserKey, tenantKey }, body, { enqueue: req.enqueue });
  return res.status(StatusCodes.CREATED).json({ override });
}

/** `PATCH /v1/currency/rates/:overrideId`: change its rate or day. The pair is fixed. */
export async function patchExchangeRateOverride(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const {
    body,
    params: { overrideId },
  } = await zParse(updateExchangeRateOverrideRequestSchema, req);
  const override = await updateExchangeRateOverride(DI.em, { appuserKey, tenantKey }, overrideId, body, { enqueue: req.enqueue });
  return res.json({ override });
}

/** `DELETE /v1/currency/rates/:overrideId`: conversions fall back to the feed rate, or to none. */
export async function removeExchangeRateOverride(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const {
    params: { overrideId },
  } = await zParse(deleteExchangeRateOverrideRequestSchema, req);
  await deleteExchangeRateOverride(DI.em, { appuserKey, tenantKey }, overrideId, { enqueue: req.enqueue });
  return res.sendStatus(StatusCodes.NO_CONTENT);
}

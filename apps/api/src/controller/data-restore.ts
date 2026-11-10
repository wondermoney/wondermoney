import type { Request, Response } from 'express';

import { DI } from '@app/database/di';
import { zParse } from '@app/validators/parser';
import { authedContext } from '@middleware/authed-context';
import { DataRestoreService } from '@service/data-restore/data-restore.service';
import { dataRestoreRequestSchema, startDataRestoreSchema, validateDataRestoreSchema } from '@validators/data-restore';

/**
 * `GET /v1/user/me/restores`: whether the person can restore an export into their household now
 * (and why not), and their restores of the last 24 hours, newest first.
 */
export async function listDataRestores(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const { availability, restores } = await new DataRestoreService(DI.em).overview({ appuserKey, tenantKey });
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ availability, restores });
}

/** `POST /v1/user/me/restores`: start a restore; the response carries the link to PUT the file to. */
export async function startDataRestore(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const { body } = await zParse(startDataRestoreSchema, req);
  const restore = await new DataRestoreService(DI.em, { enqueue: req.enqueue }).start({ appuserKey, tenantKey }, { size: body.size });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(201).json({ restore });
}

/** `GET /v1/user/me/restores/:restoreId`: status, and what a validated file would restore. */
export async function getDataRestore(req: Request, res: Response) {
  const { appuserKey } = authedContext(req);
  const { params: { restoreId } } = await zParse(dataRestoreRequestSchema, req);
  const restore = await new DataRestoreService(DI.em).get(appuserKey, restoreId);
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ restore });
}

/**
 * `POST /v1/user/me/restores/:restoreId/validate`: check the uploaded file (a dry run, in the
 * background). A `password` in the body opens a protected export; it is never logged.
 */
export async function validateDataRestore(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const { body, params: { restoreId } } = await zParse(validateDataRestoreSchema, req);
  const restore = await new DataRestoreService(DI.em, { enqueue: req.enqueue }).validate({ appuserKey, tenantKey }, restoreId, body?.password === undefined ? {} : { password: body.password });
  return res.status(202).json({ restore });
}

/** `POST /v1/user/me/restores/:restoreId/commit`: restore a validated file (in the background). */
export async function commitDataRestore(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const { params: { restoreId } } = await zParse(dataRestoreRequestSchema, req);
  const restore = await new DataRestoreService(DI.em, { enqueue: req.enqueue }).commit({ appuserKey, tenantKey }, restoreId);
  return res.status(202).json({ restore });
}

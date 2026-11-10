import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { authedContext } from '@middleware/authed-context';
import {
  createTag as createTagService,
  deleteTag as deleteTagService,
  listTags,
  setTransactionTags as setTransactionTagsService,
  updateTag as updateTagService,
} from '@service/tag/tag.service';
import { zParse } from '@validators/parser';
import { createTagRequestSchema, deleteTagRequestSchema, setTransactionTagsRequestSchema, updateTagRequestSchema } from '@validators/tag';

import { DI } from '../app';

export async function createTag(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const { body } = await zParse(createTagRequestSchema, req);
  const tag = await createTagService(DI.em, { appuserKey, tenantKey }, body);
  return res.status(StatusCodes.CREATED).json({ tag });
}

export async function deleteTag(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const {
    params: { tagId },
  } = await zParse(deleteTagRequestSchema, req);
  await deleteTagService(DI.em, { appuserKey, tenantKey }, tagId);
  return res.sendStatus(StatusCodes.OK);
}

export async function getTags(req: Request, res: Response) {
  const { tenantKey } = authedContext(req);
  return res.json({ tags: await listTags(DI.em, tenantKey) });
}

export async function updateTag(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const {
    body,
    params: { tagId },
  } = await zParse(updateTagRequestSchema, req);
  const tag = await updateTagService(DI.em, { appuserKey, tenantKey }, tagId, body);
  return res.json({ tag });
}

/** `PUT /v1/account/transaction/:transactionId/tags`: replace the transaction's tags. */
export async function setTransactionTags(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const {
    body: { tagIds },
    params: { transactionId },
  } = await zParse(setTransactionTagsRequestSchema, req);
  const tags = await setTransactionTagsService(DI.em, { appuserKey, tenantKey }, transactionId, tagIds);
  return res.json({ tags });
}

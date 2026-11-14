import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

import { authedContext } from '@middleware/authed-context';
import {
  createTransactionTemplate as createTransactionTemplateService,
  deleteTransactionTemplate as deleteTransactionTemplateService,
  listTransactionTemplates as listTransactionTemplatesService,
  updateTransactionTemplate as updateTransactionTemplateService,
} from '@service/transaction-template/transaction-template.service';
import { zParse } from '@validators/parser';
import {
  createTransactionTemplateSchema,
  deleteTransactionTemplateSchema,
  updateTransactionTemplateSchema,
} from '@validators/transaction-template';

import { DI } from '../app';

export async function createTransactionTemplate(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const { body } = await zParse(createTransactionTemplateSchema, req);
  const template = await createTransactionTemplateService(DI.em, { appuserKey, tenantKey }, body);
  return res.status(StatusCodes.CREATED).json({ template });
}

export async function deleteTransactionTemplate(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const {
    params: { transactionTemplateId },
  } = await zParse(deleteTransactionTemplateSchema, req);
  await deleteTransactionTemplateService(DI.em, { appuserKey, tenantKey }, transactionTemplateId);
  return res.sendStatus(StatusCodes.NO_CONTENT);
}

export async function listTransactionTemplates(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const templates = await listTransactionTemplatesService(DI.em, { appuserKey, tenantKey });
  return res.json({ templates });
}

export async function updateTransactionTemplate(req: Request, res: Response) {
  const { appuserKey, tenantKey } = authedContext(req);
  const {
    body,
    params: { transactionTemplateId },
  } = await zParse(updateTransactionTemplateSchema, req);
  const template = await updateTransactionTemplateService(DI.em, { appuserKey, tenantKey }, transactionTemplateId, body);
  return res.json({ template });
}

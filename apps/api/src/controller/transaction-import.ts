import type { Request, Response } from 'express';

import { DI } from '@app/database/di';
import { authedContext } from '@middleware/authed-context';
import { TransactionImportService } from '@service/transaction-import/transaction-import.service';
import { zParse } from '@validators/parser';
import { createTransactionImportSchema, decideTransactionImportRowsSchema, getTransactionImportSchema, mapTransactionImportAccountsSchema, mapTransactionImportCategoriesSchema, parseTransactionImportSchema, transactionImportRequestSchema } from '@validators/transaction-import';

/*
 * `/v1/transaction-import-sessions`: staged imports of a transaction file
 * (`services/transaction-import/transaction-import.service.ts`). Every route reaches only the
 * caller's own sessions in their household; anything else is 404.
 */

const serviceFor = (req: Request) => new TransactionImportService(DI.em, { enqueue: req.enqueue });
const scopeOf = (req: Request) => {
  const { appuserKey, tenantKey } = authedContext(req);
  return { appuserKey, tenantKey };
};

/** `POST /`: start an import on an account. With `key` (a file uploaded for it) it is read at once; without, the response carries the upload link. */
export async function createTransactionImport(req: Request, res: Response) {
  const { body } = await zParse(createTransactionImportSchema, req);
  const session = await serviceFor(req).create(scopeOf(req), body);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(201).json({ session });
}

/** `GET /:importId`: the summary, and one page of rows (`?status=&page=&pageSize=`). */
export async function getTransactionImport(req: Request, res: Response) {
  const { params, query } = await zParse(getTransactionImportSchema, req);
  const view = await serviceFor(req).get(scopeOf(req), params.importId, query);
  res.setHeader('Cache-Control', 'no-store');
  return res.json(view);
}

/** `POST /:importId/parse`: read the uploaded file, or read it again with corrected options. */
export async function parseTransactionImport(req: Request, res: Response) {
  const { body, params } = await zParse(parseTransactionImportSchema, req);
  const session = await serviceFor(req).parse(scopeOf(req), params.importId, { options: body?.options });
  return res.status(202).json({ session });
}

/** `PATCH /:importId/rows`: include or skip rows, by id or by status. */
export async function decideTransactionImportRows(req: Request, res: Response) {
  const { body, params } = await zParse(decideTransactionImportRowsSchema, req);
  const session = await serviceFor(req).decide(scopeOf(req), params.importId, body);
  return res.json({ session });
}

/** `PATCH /:importId/account-mapping`: which account each account in the file imports into, or a new manual account. */
export async function mapTransactionImportAccounts(req: Request, res: Response) {
  const { body, params } = await zParse(mapTransactionImportAccountsSchema, req);
  const session = await serviceFor(req).setAccountMapping(scopeOf(req), params.importId, body.mapping, { create: body.create });
  return res.json({ session });
}

/** `PATCH /:importId/category-mapping`: which category each category in the file imports as, or none. */
export async function mapTransactionImportCategories(req: Request, res: Response) {
  const { body, params } = await zParse(mapTransactionImportCategoriesSchema, req);
  const session = await serviceFor(req).setCategoryMapping(scopeOf(req), params.importId, body.mapping);
  return res.json({ session });
}

/** `POST /:importId/commit`: write the rows decided `import` (in the background). Asked again after its job stopped, it resumes. */
export async function commitTransactionImport(req: Request, res: Response) {
  const { params } = await zParse(transactionImportRequestSchema, req);
  const session = await serviceFor(req).commit(scopeOf(req), params.importId);
  return res.status(202).json({ session });
}

/** `POST /:importId/cancel`: close an import that has not been committed. */
export async function cancelTransactionImport(req: Request, res: Response) {
  const { params } = await zParse(transactionImportRequestSchema, req);
  const session = await serviceFor(req).cancel(scopeOf(req), params.importId);
  return res.json({ session });
}

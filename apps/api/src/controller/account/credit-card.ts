import type { Request, Response } from 'express';

import { DI } from '@app/app';
import { AccountType } from '@entity/AccountType';
import { CreditCardDetail } from '@entity/CreditCardDetail';
import { authedContext } from '@middleware/authed-context';
import { findTenantCardAccount, getCreditCardStatementDetail, getCreditCardStatements, mapCreditCardDetail } from '@service/account/credit-card-statement.service';
import { BadRequestError } from '@utils/errors';
import { getCreditCardStatementDetailRequestSchema, getCreditCardStatementsRequestSchema, updateCreditCardRequestSchema } from '@validators/account';
import { zParse } from '@validators/parser';

/**
 * `PUT /v1/account/:accountId/credit-card`: mark the account as a credit card and store its
 * cycle. Upserts, so the same call sets and edits the settings. The account is found through the
 * tenant filter, so another household's id is a 404.
 */
export async function putCreditCardSettings(req: Request, res: Response) {
  const { tenantKey } = authedContext(req);
  const {
    body: { creditLimit, minimumPaymentPercent, paymentDueDay, statementCloseDay },
    params: { accountId },
  } = await zParse(updateCreditCardRequestSchema, req);

  const account = await findTenantCardAccount(DI.em, accountId, tenantKey);

  let detail = await DI.em.findOne(CreditCardDetail, { accountKey: { accountKey: account.accountKey }, deletedAt: undefined });
  detail ??= DI.em.create(CreditCardDetail, { accountKey: account, paymentDueDay, statementCloseDay, tenantKey: account.tenantKey }, { partial: true });
  detail.statementCloseDay = statementCloseDay;
  detail.paymentDueDay = paymentDueDay;
  detail.creditLimit = creditLimit ?? null;
  detail.minimumPaymentPercent = minimumPaymentPercent ?? null;

  // Setting the cycle is what makes the account a credit card; the type drives the client's glyph
  // and the account lists. A missing seeded type is not worth failing the save over.
  const creditCardType = await DI.em.findOne(AccountType, { description: 'CREDIT_CARD' });
  if (creditCardType) account.accountTypeKey = creditCardType;

  await DI.em.persist(detail).flush();
  return res.json({ creditCard: mapCreditCardDetail(detail) });
}

/**
 * `GET /v1/account/:accountId/statements?from=&to=`: the statements overlapping the window, each
 * with its charges, payments, balance, due date and available credit. Defaults to the last three
 * months, ending today. A non-card account is a 400: it has no cycle to compute statements from.
 */
export async function getCreditCardStatementsHandler(req: Request, res: Response) {
  const { tenantKey } = authedContext(req);
  const {
    params: { accountId },
    query,
  } = await zParse(getCreditCardStatementsRequestSchema, req);

  const account = await findTenantCardAccount(DI.em, accountId, tenantKey);
  const detail = await DI.em.findOne(CreditCardDetail, { accountKey: { accountKey: account.accountKey }, deletedAt: undefined });
  if (!detail) throw new BadRequestError('Account is not a credit card');

  const today = new Date();
  const to = query.to ?? today;
  const from = query.from ?? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 2, 1));
  if (from.getTime() > to.getTime()) throw new BadRequestError('from must not be after to');

  const statements = await getCreditCardStatements(DI.em, {
    accountKey: account.accountKey,
    creditLimit: detail.creditLimit,
    cycle: { paymentDueDay: detail.paymentDueDay, statementCloseDay: detail.statementCloseDay },
    from,
    to,
    today,
  });
  return res.json({ statements });
}

/**
 * `GET /v1/account/:accountId/statements/:statementDate`: one statement (named by its close day)
 * with the transactions it counts. The account is found through the tenant filter, so another
 * household's card is a 404; a date that is not one of this card's close days is a 400.
 */
export async function getCreditCardStatementDetailHandler(req: Request, res: Response) {
  const { tenantKey } = authedContext(req);
  const {
    params: { accountId, statementDate },
  } = await zParse(getCreditCardStatementDetailRequestSchema, req);

  const account = await findTenantCardAccount(DI.em, accountId, tenantKey);
  const detail = await DI.em.findOne(CreditCardDetail, { accountKey: { accountKey: account.accountKey }, deletedAt: undefined });
  if (!detail) throw new BadRequestError('Account is not a credit card');

  const statement = await getCreditCardStatementDetail(DI.em, {
    accountKey: account.accountKey,
    creditLimit: detail.creditLimit,
    cycle: { paymentDueDay: detail.paymentDueDay, statementCloseDay: detail.statementCloseDay },
    statementDate,
  });
  return res.json({ statement });
}

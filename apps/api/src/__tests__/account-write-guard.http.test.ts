import { RequestContext } from '@mikro-orm/postgresql';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { TEST_USER_HEADER } from '@app/__tests__/__helpers__/auth-session-double';
import { addAccount, addPartner, addShare, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { AUTHED_MOUNTS, routesOf } from '@app/openapi/route-discovery';
import type { Account } from '@entity/Account';
import type { Appuser } from '@entity/Appuser';
import { Goal } from '@entity/Goal';
import { InstallmentPlan } from '@entity/InstallmentPlan';
import { Loan } from '@entity/Loan';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { RecurringSeries } from '@entity/RecurringSeries';
import { Transaction } from '@entity/Transaction';
import { TransactionOCRImport } from '@entity/TransactionOCRImport';
import { errorHandler } from '@middleware/error-handler';
import { authedTenant } from '@middleware/stacks';
import { LoanAllocationSource, LoanPaymentFrequency, LoanRateType, LoanStatus, LoanType } from '@service/loan/loan-types';
import { ERROR_CODE } from '@utils/errors';

/*
 * A member a private account is shared with for viewing only may read it and change none of it.
 * This walks every write route mounted behind `authedTenant` and fails when one is not classified:
 *
 * - `GUARDED`: changes one account's data (the account, its transactions, tags, splits,
 *   reimbursements, attachments, imports, card settings, installments, recurring series, loan
 *   repayments, goal funding). Each is sent here, as the view-only member, through the real
 *   routers and middleware, and must answer 403 `account_read_only` and change nothing.
 * - `SERVICE_CHECKED`: touches account data but decides per row in its service (a rule run or an
 *   assistant proposal leaves view-only rows alone; imports and bank links are the owner's own).
 * - everything else in a mount that holds account routes must be listed in `NOT_ACCOUNT_DATA`;
 *   mounts in `OTHER_MOUNTS` hold no account data at all.
 */
interface Ids {
  account: number;
  goal: number;
  loan: number;
  ocrImport: number;
  plan: number;
  repayment: number;
  series: number;
  transaction: number;
}

interface WriteCase {
  body?: unknown;
  path: (ids: Ids) => string;
}

const allocation = { feeAmount: 0, interestAmount: 0, principalAmount: 10, totalPaymentAmount: 10 };

const GUARDED: Record<string, WriteCase> = {
  'DELETE /v1/account/:accountId': { path: (ids) => `/v1/account/${ids.account}` },
  'DELETE /v1/account/transaction': { body: { transactionIds: [0] }, path: () => '/v1/account/transaction' },
  'DELETE /v1/account/transaction/:transactionId': { path: (ids) => `/v1/account/transaction/${ids.transaction}` },
  'DELETE /v1/account/transaction/:transactionId/attachments/:attachmentId': { path: (ids) => `/v1/account/transaction/${ids.transaction}/attachments/1` },
  'DELETE /v1/account/transaction/:transactionId/reimbursements/:reimbursementId': { path: (ids) => `/v1/account/transaction/${ids.transaction}/reimbursements/1` },
  'DELETE /v1/account/transaction/:transactionId/splits': { path: (ids) => `/v1/account/transaction/${ids.transaction}/splits` },
  'DELETE /v1/installment-plans/:installmentPlanId': { path: (ids) => `/v1/installment-plans/${ids.plan}` },
  'DELETE /v1/installment-plans/:installmentPlanId/installments/:installmentNumber/link': { path: (ids) => `/v1/installment-plans/${ids.plan}/installments/1/link` },
  'DELETE /v1/loan/:loanId/repayments/:repaymentLinkId': { path: (ids) => `/v1/loan/${ids.loan}/repayments/${ids.repayment}` },
  'PATCH /v1/account/:accountId': { body: { accountName: 'Renamed' }, path: (ids) => `/v1/account/${ids.account}` },
  'PATCH /v1/account/transaction': { body: { reviewed: true, transactionIds: [0] }, path: () => '/v1/account/transaction' },
  'PATCH /v1/account/transaction/:transactionId': { body: { notes: 'changed' }, path: (ids) => `/v1/account/transaction/${ids.transaction}` },
  'PATCH /v1/installment-plans/:installmentPlanId': { body: { description: 'Changed' }, path: (ids) => `/v1/installment-plans/${ids.plan}` },
  'PATCH /v1/loan/:loanId/repayments/:repaymentLinkId': { body: allocation, path: (ids) => `/v1/loan/${ids.loan}/repayments/${ids.repayment}` },
  'PATCH /v1/recurring/:recurringSeriesId': { body: { displayName: 'Changed' }, path: (ids) => `/v1/recurring/${ids.series}` },
  'POST /v1/account/:accountId/recalculate': { path: (ids) => `/v1/account/${ids.account}/recalculate` },
  'POST /v1/account/:accountId/transaction': { body: {}, path: (ids) => `/v1/account/${ids.account}/transaction` },
  'POST /v1/account/:accountId/transaction/import': { body: {}, path: (ids) => `/v1/account/${ids.account}/transaction/import` },
  'POST /v1/account/:accountId/transaction/import/preview': { body: {}, path: (ids) => `/v1/account/${ids.account}/transaction/import/preview` },
  'POST /v1/account/:accountId/transaction/upload': { body: {}, path: (ids) => `/v1/account/${ids.account}/transaction/upload` },
  'POST /v1/account/transaction/:transactionId/attachments': { body: {}, path: (ids) => `/v1/account/transaction/${ids.transaction}/attachments` },
  'POST /v1/account/transaction/:transactionId/attachments/upload-url': { body: {}, path: (ids) => `/v1/account/transaction/${ids.transaction}/attachments/upload-url` },
  'POST /v1/account/transaction/:transactionId/reimbursements': { body: {}, path: (ids) => `/v1/account/transaction/${ids.transaction}/reimbursements` },
  'POST /v1/goals/:goalKey/fund-transaction': { body: { amount: 1, transactionKey: 0 }, path: (ids) => `/v1/goals/${ids.goal}/fund-transaction` },
  'POST /v1/installment-plans': { body: { accountKey: 0, description: 'Phone', installmentCount: 3, purchaseDate: '2026-11-01', totalAmount: 300 }, path: () => '/v1/installment-plans' },
  'POST /v1/installment-plans/:installmentPlanId/installments/:installmentNumber/link': { body: { transactionKey: 0 }, path: (ids) => `/v1/installment-plans/${ids.plan}/installments/1/link` },
  'POST /v1/loan/:loanId/repayments/link': { body: allocation, path: (ids) => `/v1/loan/${ids.loan}/repayments/link?transactionKey=${ids.transaction}` },
  'POST /v1/recurring/:recurringSeriesId/confirm': { path: (ids) => `/v1/recurring/${ids.series}/confirm` },
  'POST /v1/recurring/:recurringSeriesId/dismiss': { path: (ids) => `/v1/recurring/${ids.series}/dismiss` },
  'PUT /v1/account/:accountId/credit-card': { body: {}, path: (ids) => `/v1/account/${ids.account}/credit-card` },
  'PUT /v1/account/transaction/:transactionId/splits': { body: [], path: (ids) => `/v1/account/transaction/${ids.transaction}/splits` },
  'PUT /v1/account/transaction/:transactionId/tags': { body: { tagIds: [] }, path: (ids) => `/v1/account/transaction/${ids.transaction}/tags` },
  'PUT /v1/account/transaction/ocr/:transactionOCRImportId/confirm': {
    body: { accountId: 0, settlementAmount: '-5', settlementCurrencyId: 1, transactionDate: '2026-11-01', transactionTypeId: 1 },
    path: (ids) => `/v1/account/transaction/ocr/${ids.ocrImport}/confirm`,
  },
};

/** Writes over account data whose service decides row by row (see the module comment). */
const SERVICE_CHECKED = new Set([
  'DELETE /v1/banking/requisition/:requisitionId', // the connection's own member only
  'DELETE /v1/banking/simplefin/connections/:connectionId', // the connection's own member only
  'PATCH /v1/transaction-import-sessions/:importId/account-mapping', // the member's own accounts only
  'POST /v1/assistant/proposals/:proposalId/apply', // fails on a view-only row (assistant-proposal.service.ts)
  'POST /v1/portfolio', // linking an account needs write access (portfolio-account-link.ts)
  'POST /v1/rule/:ruleId/apply', // view-only rows are left alone (ruleRunTransactionsWhere)
  'POST /v1/rule/apply-all',
  'POST /v1/transaction-import-sessions/:importId/commit', // the member's own accounts only
  'PUT /v1/account/:accountId/shares', // its own rule: the account owner or the household owner
  'PUT /v1/portfolio/:portfolioId', // linking an account needs write access (portfolio-account-link.ts)
]);

/** Writes in mounts that also hold account routes, which change no account's data. */
const NOT_ACCOUNT_DATA = new Set([
  'DELETE /v1/goals/:goalKey',
  'DELETE /v1/goals/:goalKey/accounts/:accountKey',
  'DELETE /v1/goals/:goalKey/fund-transaction/:fundingKey',
  'DELETE /v1/loan/:loanId',
  'DELETE /v1/loan/:loanId/adjustments/:adjustmentId',
  'DELETE /v1/loan/:loanId/rate-periods/:ratePeriodId',
  'DELETE /v1/portfolio/:portfolioId',
  'DELETE /v1/portfolio/:portfolioId/transaction/:transactionId',
  'DELETE /v1/portfolio/holding/:financialAssetKey/prices/:date',
  'DELETE /v1/rule/:ruleId',
  'PATCH /v1/account/transaction-merchants/:merchantId', // a household merchant, not an account's
  'PATCH /v1/goals/:goalKey',
  'PATCH /v1/loan/:loanId',
  'PATCH /v1/loan/:loanId/adjustments/:adjustmentId',
  'PATCH /v1/loan/:loanId/rate-periods/:ratePeriodId',
  'PATCH /v1/rule/:ruleId',
  'PATCH /v1/transaction-import-sessions/:importId/category-mapping',
  'PATCH /v1/transaction-import-sessions/:importId/rows',
  'POST /v1/account/offline', // a new account of the member's own
  'POST /v1/account/transaction/ocr', // a scan; the transaction is made by confirming it
  'POST /v1/assistant/chat',
  'POST /v1/assistant/consent',
  'POST /v1/assistant/disable',
  'POST /v1/assistant/proposals/:proposalId/reject',
  'POST /v1/banking/simplefin/connections', // a new connection makes the member's own accounts
  'POST /v1/goals',
  'POST /v1/goals/:goalKey/accounts',
  'POST /v1/goals/:goalKey/assign',
  'POST /v1/goals/:goalKey/move-out',
  'POST /v1/goals/:goalKey/restore',
  'POST /v1/loan',
  'POST /v1/loan/:loanId/adjustments',
  'POST /v1/loan/:loanId/rate-periods',
  'POST /v1/portfolio/:portfolioId/import-sessions',
  'POST /v1/portfolio/:portfolioId/snapshot/rebuild',
  'POST /v1/portfolio/:portfolioId/transaction',
  'POST /v1/recurring/detect',
  'POST /v1/rule',
  'POST /v1/rule/import',
  'POST /v1/rule/presets/:code/install',
  'POST /v1/rule/preview',
  'POST /v1/rule/suggestions/dismiss',
  'POST /v1/transaction-import-sessions',
  'POST /v1/transaction-import-sessions/:importId/cancel',
  'POST /v1/transaction-import-sessions/:importId/parse',
  'POST /v1/transaction-import-sessions/pdf',
  'PUT /v1/account/order', // the member's own order
  'PUT /v1/account/transaction/ocr/:transactionOCRImportId/reject',
  'PUT /v1/portfolio/:portfolioId/transaction/:transactionId',
  'PUT /v1/portfolio/holding/:financialAssetKey/prices/:date',
  'PUT /v1/rule/order',
]);

/** Mounts with no account data at all. */
const OTHER_MOUNTS = new Set([
  '/v1/budget',
  '/v1/category',
  '/v1/configs',
  '/v1/currency',
  '/v1/feedback',
  '/v1/financial-markets',
  '/v1/household',
  '/v1/insights',
  '/v1/manual-assets',
  '/v1/net-worth',
  '/v1/operations',
  '/v1/portfolio-import-sessions',
  '/v1/reports',
  '/v1/tag',
  '/v1/transaction-template',
  '/v1/user',
]);

const keyOf = (route: { method: string; mount: string; path: string }) => {
  const path = `${route.mount}${route.path}`;
  return `${route.method} ${path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path}`;
};

describe('a member who may only view an account', () => {
  const db = useTestDatabase();
  beforeEach(() => {
    DI.em = db.orm.em;
  });

  async function app() {
    const server = express();
    server.use((_req, _res, next) => {
      RequestContext.create(db.orm.em, next);
    });
    server.use(express.json());
    for (const [mount, load] of Object.entries(AUTHED_MOUNTS)) server.use(mount, ...authedTenant(), await load());
    server.use(errorHandler);
    return server;
  }

  async function household(access: 'read' | 'write') {
    const em = db.em();
    const owner: Household = await seedHousehold(em);
    const member: Appuser = await addPartner(em, owner);
    const account: Account = await addAccount(em, owner, { isPrivate: true, name: 'Joint card' });
    await addShare(em, owner, account, member, access);
    const transaction: Transaction = await addTransaction(em, owner, { account, amount: -40, date: new Date('2026-11-02'), status: 'BOOKED' });
    const plan = em.create(InstallmentPlan, { accountKey: account, description: 'Laptop', installmentCount: 3, purchaseDate: new Date('2026-11-01'), tenantKey: owner.tenant, totalAmount: 900 }, { partial: true });
    const series = em.create(RecurringSeries, { accountKey: account, displayName: 'Gym', normalizedMerchantKey: 'gym', tenantKey: owner.tenant }, { partial: true });
    const loan = em.create(Loan, {
      currencyKey: owner.currency, name: 'Car', openingBalanceDate: new Date('2026-01-01'), openingPrincipalBalance: 5000, ownerAppuserKey: member,
      paymentFrequency: LoanPaymentFrequency.MONTHLY, rateType: LoanRateType.FIXED, status: LoanStatus.ACTIVE, tenantKey: owner.tenant, type: LoanType.AUTO_LOAN,
    }, { partial: true });
    const repayment = em.create(LoanRepaymentLink, {
      allocationSource: LoanAllocationSource.MANUAL, feeAmount: 0, interestAmount: 0, linkedByAppuserKey: owner.appuser, loanKey: loan,
      paymentDate: new Date('2026-11-02'), principalAmount: 10, tenantKey: owner.tenant, totalPaymentAmount: 10, transactionKey: transaction,
    }, { partial: true });
    const goal = em.create(Goal, { appuserKey: member, currencyKey: owner.currency, name: 'Holiday', priority: 1, targetAmount: 1000, tenantKey: owner.tenant }, { partial: true });
    const ocrImport = em.create(TransactionOCRImport, { appuserKey: member, fileUrl: 'receipts/scan.jpg', tokensSpent: 0 }, { partial: true });
    await em.flush();
    const ids: Ids = {
      account: account.accountKey, goal: goal.goalKey, loan: loan.loanKey, ocrImport: ocrImport.transactionOCRImportKey,
      plan: plan.installmentPlanKey, repayment: repayment.loanRepaymentLinkKey, series: series.recurringSeriesKey, transaction: transaction.transactionKey,
    };
    return { account, ids, member, owner, transaction };
  }

  /** Fill the body's key placeholders (0) with the fixture's keys. */
  function bodyFor(key: string, body: unknown, ids: Ids): unknown {
    if (body === undefined || Array.isArray(body) || typeof body !== 'object' || body === null) return body;
    const filled: Record<string, unknown> = { ...body };
    if ('transactionIds' in filled) filled['transactionIds'] = [ids.transaction];
    if ('transactionKey' in filled) filled['transactionKey'] = ids.transaction;
    if (key === 'POST /v1/installment-plans') filled['accountKey'] = ids.account;
    if ('accountId' in filled) filled['accountId'] = ids.account;
    return filled;
  }

  function send(server: express.Express, key: string, ids: Ids, as: Appuser) {
    const write = GUARDED[key]!;
    const method = key.split(' ')[0]!.toLowerCase() as 'delete' | 'patch' | 'post' | 'put';
    const call = request(server)[method](write.path(ids)).set(TEST_USER_HEADER, as.externalUserId);
    const body = bodyFor(key, write.body, ids);
    return body === undefined ? call : call.send(body as object);
  }

  it('classifies every mounted write route', async () => {
    const writes: string[] = [];
    for (const [mount, load] of Object.entries(AUTHED_MOUNTS)) {
      if (OTHER_MOUNTS.has(mount)) continue;
      writes.push(...routesOf(await load(), mount).filter((route) => !['GET', 'HEAD', 'OPTIONS'].includes(route.method)).map(keyOf));
    }
    const known = new Set([...Object.keys(GUARDED), ...SERVICE_CHECKED, ...NOT_ACCOUNT_DATA]);
    expect(writes.filter((key) => !known.has(key))).toEqual([]);
    expect([...known].filter((key) => !writes.includes(key))).toEqual([]);
  });

  it.each(Object.keys(GUARDED))('%s answers 403 account_read_only', async (key) => {
    const { ids, member } = await household('read');
    const response = await send(await app(), key, ids, member);

    expect({ code: response.body.code, status: response.status }).toEqual({ code: ERROR_CODE.ACCOUNT_READ_ONLY, status: 403 });
  });

  it('changes nothing when refused', async () => {
    const { account, ids, member, transaction } = await household('read');
    const server = await app();
    for (const key of Object.keys(GUARDED)) await send(server, key, ids, member);

    const em = db.em();
    const stored = await em.findOneOrFail(Transaction, { transactionKey: transaction.transactionKey }, { filters: false, populate: ['accountKey'] });
    expect({ deleted: stored.deletedAt ?? null, notes: stored.notes ?? null, reviewed: stored.reviewed }).toEqual({ deleted: null, notes: null, reviewed: transaction.reviewed });
    expect({ deleted: stored.accountKey?.deletedAt ?? null, name: stored.accountKey?.accountName }).toEqual({ deleted: null, name: account.accountName });
    await expect(em.count(InstallmentPlan, { deletedAt: null }, { filters: false })).resolves.toBe(1);
  });

  it('lets a member with edit access change the account and its transactions', async () => {
    const { ids, member } = await household('write');
    const server = await app();

    expect((await send(server, 'PATCH /v1/account/:accountId', ids, member)).status).toBe(200);
    expect((await send(server, 'PATCH /v1/account/transaction/:transactionId', ids, member)).status).toBe(200);
  });
});

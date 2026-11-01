import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { addTransaction, type Household, seedHousehold, type StatusName } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Loan } from '@entity/Loan';
import { LoanPaymentFrequency, LoanRateType, LoanStatus, LoanType } from '@service/loan/loan-types';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { linkLoanRepayment, listLoanRepaymentCandidates } from '../loan';

async function call(handler: (req: Request, res: Response) => Promise<unknown>, household: Household, request: { body?: unknown; params: Record<string, string>; query?: Record<string, string> }) {
  const result: { body?: Record<string, unknown>; status?: number } = {};
  const res = {
    json: (payload: Record<string, unknown>) => { result.body = payload; return res; },
    sendStatus: (status: number) => { result.status = status; return res; },
    status: (status: number) => { result.status = status; return res; },
  } as unknown as Response;
  await handler({ body: request.body ?? {}, headers: {}, params: request.params, query: request.query ?? {}, user: household.appuser } as unknown as Request, res);
  return result;
}

/* A rejected or cancelled payment (EXPIRED) never repaid anything, so it is no repayment candidate. */
describe('loan repayments and transaction status', () => {
  const db = useTestDatabase();

  async function seedLoanAndPayments() {
    const em = db.em();
    const household = await seedHousehold(em);
    const loan = em.create(Loan, { currencyKey: household.currency, name: 'Car', openingBalanceDate: new Date('2026-01-01'), openingPrincipalBalance: 5000, ownerAppuserKey: household.appuser, paymentFrequency: LoanPaymentFrequency.MONTHLY, rateType: LoanRateType.FIXED, status: LoanStatus.ACTIVE, tenantKey: household.tenant, type: LoanType.AUTO_LOAN }, { partial: true });
    await em.flush();
    const keys = {} as Record<'none' | StatusName, number>;
    for (const [index, status] of (['BOOKED', 'PENDING', 'EXPIRED', null] as const).entries()) {
      keys[status ?? 'none'] = (await addTransaction(em, household, { amount: -200, date: new Date(Date.UTC(2026, 6, 1 + index)), status })).transactionKey;
    }
    return { household, keys, loan };
  }

  it('does not offer an expired payment as a repayment candidate', async () => {
    const { household, keys, loan } = await seedLoanAndPayments();

    const { body } = await call(listLoanRepaymentCandidates, household, { params: { loanId: String(loan.loanKey) } });

    const offered = (body?.['candidates'] as { transaction: { transactionKey: number } }[]).map((candidate) => candidate.transaction.transactionKey);
    expect(offered.sort()).toEqual([keys.BOOKED, keys.PENDING, keys.none].sort());
  });

  it('refuses to link an expired payment as a repayment', async () => {
    const { household, keys, loan } = await seedLoanAndPayments();

    const result = await call(linkLoanRepayment, household, { body: { feeAmount: 0, interestAmount: 0, principalAmount: 200, totalPaymentAmount: 200 }, params: { loanId: String(loan.loanKey) }, query: { transactionKey: String(keys.EXPIRED) } });

    expect(result.status).toBe(404);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Loan } from '@entity/Loan';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { Transaction } from '@entity/Transaction';

const mocked = vi.hoisted(() => ({
  assign: vi.fn((target: Record<string, unknown>, patch: Record<string, unknown>) => Object.assign(target, patch)),
  create: vi.fn(),
  find: vi.fn(),
  findOne: vi.fn(),
  flush: vi.fn(),
  getAppuserTenantByAppuser: vi.fn(),
  getRepository: vi.fn(),
  persist: vi.fn(),
}));

vi.mock('@app/app', () => ({
  DI: {
    em: {
      assign: mocked.assign,
      create: mocked.create,
      find: mocked.find,
      findOne: mocked.findOne,
      flush: mocked.flush,
      getRepository: mocked.getRepository,
      persist: mocked.persist,
    },
  },
}));

vi.mock('@validators/parser', () => ({
  zParse: vi.fn((_schema, req: unknown) => Promise.resolve(req)),
}));

import { mockReq, mockRes } from '../../__tests__/__helpers__/mock-request';
import { linkLoanRepayment, updateLoanRepayment } from '../loan';

const APPUSER = { appuserKey: 1 };
const TENANT = { tenantKey: 7 };

function makeLoan(overrides: Record<string, unknown> = {}) {
  return {
    loanKey: 10,
    openingPrincipalBalance: 100,
    ownerAppuserKey: APPUSER,
    tenantKey: TENANT,
    ...overrides,
  };
}

function makeRepayment(overrides: Record<string, unknown> = {}) {
  return {
    allocationSource: 'MANUAL',
    feeAmount: 20,
    interestAmount: 30,
    linkedByAppuserKey: APPUSER,
    loanKey: makeLoan(),
    loanRepaymentLinkKey: 44,
    needsReview: false,
    paymentDate: new Date('2026-01-15T00:00:00.000Z'),
    principalAmount: 50,
    tenantKey: TENANT,
    totalPaymentAmount: 100,
    transactionKey: makeTransaction(),
    ...overrides,
  };
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return Object.assign(
    mockReq({ body: { feeAmount: 0, interestAmount: 0, principalAmount: 100, totalPaymentAmount: 100 }, query: { transactionKey: 22 } }),
    { params: { loanId: 10, repaymentLinkId: 44 }, user: APPUSER },
    overrides,
  );
}

function makeTransaction(overrides: Record<string, unknown> = {}) {
  return {
    description: 'Loan repayment',
    settlementAmount: -100,
    tenantKey: TENANT,
    transactionDate: new Date('2026-01-15T00:00:00.000Z'),
    transactionKey: 22,
    transactionMerchantKey: { name: 'Lender' },
    ...overrides,
  };
}

function setupContext() {
  mocked.getAppuserTenantByAppuser.mockResolvedValue(TENANT);
  mocked.getRepository.mockReturnValue({ getAppuserTenantByAppuser: mocked.getAppuserTenantByAppuser });
  mocked.find.mockResolvedValue([]);
  mocked.flush.mockResolvedValue(undefined);
  mocked.persist.mockReturnValue({ flush: mocked.flush });
}

function setupLinkPath({
  duplicate = null,
  loan = makeLoan(),
  repayments = [],
  transaction = makeTransaction(),
}: {
  duplicate?: null | Record<string, unknown>;
  loan?: null | Record<string, unknown>;
  repayments?: Record<string, unknown>[];
  transaction?: null | Record<string, unknown>;
} = {}) {
  mocked.findOne
    .mockResolvedValueOnce(loan)
    .mockResolvedValueOnce(transaction)
    .mockResolvedValueOnce(duplicate);
  mocked.find.mockResolvedValueOnce(repayments);
}

describe('loan repayment mutation scoping and allocation validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupContext();
  });

  it('scopes the loan lookup to the authenticated appuser and tenant', async () => {
    mocked.findOne.mockResolvedValueOnce(null);
    const sendStatus = vi.fn();

    await linkLoanRepayment(makeRequest(), mockRes({ sendStatus }));

    expect(sendStatus).toHaveBeenCalledWith(404);
    expect(mocked.findOne).toHaveBeenCalledWith(
      Loan,
      { deletedAt: undefined, loanKey: 10, ownerAppuserKey: APPUSER, tenantKey: TENANT.tenantKey },
      { populate: ['currencyKey'] },
    );
    expect(mocked.findOne).toHaveBeenCalledTimes(1);
  });

  it('does not link a transaction from another tenant', async () => {
    mocked.findOne.mockResolvedValueOnce(makeLoan()).mockResolvedValueOnce(null);
    const sendStatus = vi.fn();

    await linkLoanRepayment(makeRequest(), mockRes({ sendStatus }));

    expect(sendStatus).toHaveBeenCalledWith(404);
    expect(mocked.findOne).toHaveBeenNthCalledWith(
      2,
      Transaction,
      { deletedAt: undefined, settlementAmount: { $lt: 0 }, tenantKey: TENANT.tenantKey, transactionKey: 22 },
      { populate: ['transactionMerchantKey'] },
    );
    expect(mocked.findOne).toHaveBeenCalledTimes(2);
  });

  it('rejects linking the same active transaction twice', async () => {
    const duplicate = makeRepayment();
    setupLinkPath({ duplicate });

    await expect(linkLoanRepayment(makeRequest(), mockRes())).rejects.toMatchObject({
      message: 'Repayment already linked',
      status: 409,
    });
    expect(mocked.find).not.toHaveBeenCalled();
    expect(mocked.persist).not.toHaveBeenCalled();
  });

  it('rejects an allocation that exceeds the transaction amount', async () => {
    setupLinkPath();

    await expect(linkLoanRepayment(makeRequest({
      body: { feeAmount: 10.02, interestAmount: 0, principalAmount: 90, totalPaymentAmount: 100.02 },
    }), mockRes())).rejects.toMatchObject({
      message: 'totalPaymentAmount exceeds transaction amount',
      status: 400,
    });
    expect(mocked.persist).not.toHaveBeenCalled();
  });

  it('rejects an allocation that exceeds outstanding principal', async () => {
    setupLinkPath({ transaction: makeTransaction({ settlementAmount: -101 }) });

    await expect(linkLoanRepayment(makeRequest({
      body: { feeAmount: 0, interestAmount: 0, principalAmount: 100.02, totalPaymentAmount: 100.02 },
    }), mockRes())).rejects.toMatchObject({
      message: 'principalAmount exceeds outstanding principal',
      status: 400,
    });
    expect(mocked.persist).not.toHaveBeenCalled();
  });

  it('accepts the configured one-cent tolerance at both allocation limits', async () => {
    const repayment = makeRepayment({ feeAmount: 0, interestAmount: 0, principalAmount: 100.01, totalPaymentAmount: 100.01 });
    setupLinkPath();
    mocked.create.mockReturnValue(repayment);

    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    await linkLoanRepayment(makeRequest({
      body: { feeAmount: 0, interestAmount: 0, principalAmount: 100.01, totalPaymentAmount: 100.01 },
    }), mockRes({ json, status }));

    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({ repayment: expect.any(Object) });
    expect(mocked.persist).toHaveBeenCalledWith(repayment);
  });

  it('scopes repayment updates by loan, link key, and tenant', async () => {
    mocked.findOne.mockResolvedValueOnce(makeLoan()).mockResolvedValueOnce(null);
    const sendStatus = vi.fn();

    await updateLoanRepayment(makeRequest({ body: {} }), mockRes({ sendStatus }));

    expect(sendStatus).toHaveBeenCalledWith(404);
    expect(mocked.findOne).toHaveBeenNthCalledWith(
      2,
      LoanRepaymentLink,
      { deletedAt: undefined, loanKey: makeLoan(), loanRepaymentLinkKey: 44, tenantKey: TENANT.tenantKey },
      { populate: ['loanKey', 'transactionKey'] },
    );
  });

  it('revalidates an update against the linked transaction amount', async () => {
    const repayment = makeRepayment();
    mocked.findOne.mockResolvedValueOnce(makeLoan()).mockResolvedValueOnce(repayment);

    await expect(updateLoanRepayment(makeRequest({
      body: { feeAmount: 0, interestAmount: 0, principalAmount: 100.02, totalPaymentAmount: 100.02 },
    }), mockRes())).rejects.toMatchObject({
      message: 'totalPaymentAmount exceeds transaction amount',
      status: 400,
    });
    expect(mocked.find).not.toHaveBeenCalled();
    expect(mocked.persist).not.toHaveBeenCalled();
  });

  it('revalidates an updated principal against the other active repayments', async () => {
    const repayment = makeRepayment({ transactionKey: makeTransaction({ settlementAmount: -201 }) });
    mocked.findOne.mockResolvedValueOnce(makeLoan()).mockResolvedValueOnce(repayment);
    mocked.find.mockImplementationOnce(() => Promise.resolve([{ paymentDate: repayment.paymentDate, principalAmount: 50 }]));

    await expect(updateLoanRepayment(makeRequest({
      body: { feeAmount: 0, interestAmount: 0, principalAmount: 200, totalPaymentAmount: 200 },
    }), mockRes())).rejects.toMatchObject({
      message: 'principalAmount exceeds outstanding principal',
      status: 400,
    });
    expect(mocked.persist).not.toHaveBeenCalled();
  });
});

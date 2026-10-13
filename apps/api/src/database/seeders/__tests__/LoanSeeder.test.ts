import type { Dictionary, EntityManager } from '@mikro-orm/core';
import { describe, expect, it, vi } from 'vitest';

import { LoanAllocationSource, LoanStatus, LoanType } from '@service/loan/loan-types';

import { demoLoans } from '../demo/demo-loans';
import { LoanSeeder } from '../LoanSeeder';

describe('LoanSeeder', () => {
  it('creates demo/admin loans and links mortgage repayments', async () => {
    const created: unknown[] = [];
    const persisted: unknown[] = [];
    const em = {
      create: (_entity: unknown, data: unknown) => {
        created.push(data);
        return data;
      },
      flush: vi.fn().mockResolvedValue(undefined),
      persist: vi.fn().mockImplementation((entities: unknown[]) => { persisted.push(...entities); return em; }),
    } as unknown as EntityManager;

    const eur = { code: 'EUR', currencyKey: 1 };
    const demoAppuser = { appuserKey: 1 };
    const adminAppuser = { appuserKey: 2 };
    const demoTenant = { tenantKey: 1 };
    const adminTenant = { tenantKey: 2 };
    const demoMortgageTransaction = {
      appuserKey: demoAppuser,
      description: 'Pag Empréstimo Hipoteca',
      settlementAmount: -600,
      tenantKey: demoTenant,
      transactionDate: new Date('2026-01-01T00:00:00.000Z'),
      transactionKey: 101,
    };
    const adminMortgageTransaction = {
      appuserKey: adminAppuser,
      description: 'Pag Empréstimo Hipoteca',
      settlementAmount: -600,
      tenantKey: adminTenant,
      transactionDate: new Date('2026-01-01T00:00:00.000Z'),
      transactionKey: 201,
    };

    const ctx: Dictionary = {
      _ADMIN_appuser: adminAppuser,
      _ADMIN_tenant: adminTenant,
      _DEMO_appuser: demoAppuser,
      _DEMO_tenant: demoTenant,
      currencies: [eur],
      transactions: [demoMortgageTransaction, adminMortgageTransaction],
    };

    await new LoanSeeder().run(em, ctx);

    expect(ctx['loans']).toHaveLength(6);
    expect(ctx['loanRepaymentLinks']).toHaveLength(2);
    expect(persisted).toHaveLength(8);
    expect(ctx['loans'][0]).toMatchObject({
      name: demoLoans.mortgage.name,
      currencyKey: eur,
      includeInNetWorth: true,
      ownerAppuserKey: demoAppuser,
      status: LoanStatus.ACTIVE,
      tenantKey: demoTenant,
      type: LoanType.MORTGAGE,
    });
    expect(demoLoans.mortgage).toMatchObject({
      openingPrincipalBalance: 142_350,
      originalPrincipal: 185_000,
      regularPaymentAmount: 600,
    });
    expect(ctx['loanRepaymentLinks'][0]).toMatchObject({
      allocationSource: LoanAllocationSource.MANUAL,
      loanKey: ctx['loans'][0],
      interestAmount: 280,
      principalAmount: 320,
      totalPaymentAmount: 600,
      transactionKey: demoMortgageTransaction,
    });
  });
});

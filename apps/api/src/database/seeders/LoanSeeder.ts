// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';
import { Seeder } from '@mikro-orm/seeder';
import { addMonths, subMonths } from 'date-fns';

import { Appuser } from '@entity/Appuser';
import { Loan } from '@entity/Loan';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { Currency } from '@entity/Currency';
import { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import {
  LoanAllocationSource,
  LoanStatus,
  LoanType,
  LoanPaymentFrequency,
  LoanRateType,
} from '@service/loan/loan-types';

import { getSeedToday, requireSeedDependency } from '../utils/seed';
import { demoLoans } from './demo/demo-loans';

const USERS_TO_SEED = [
  { appUser: 'DEMO', tenant: 'DEMO' },
  { appUser: 'ADMIN', tenant: 'ADMIN' },
] as const;

export class LoanSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const currency = requireSeedDependency(
      ctx['currencies'].find((c: Currency) => c.code === 'EUR'),
      'EUR currency',
    );
    const seedToday = getSeedToday();
    const loans: Loan[] = [];
    const repaymentLinks: LoanRepaymentLink[] = [];

    for (const user of USERS_TO_SEED) {
      const appuser = requireSeedDependency(
        user.appUser === 'ADMIN' ? ctx['_ADMIN_appuser'] : ctx['_DEMO_appuser'],
        `${user.appUser} appuser`,
      ) as Appuser;
      const tenant = requireSeedDependency(
        user.tenant === 'ADMIN' ? ctx['_ADMIN_tenant'] : ctx['_DEMO_tenant'],
        `${user.tenant} tenant`,
      ) as Tenant;
      const openingBalanceDate = subMonths(seedToday, 1);

      const mortgage = em.create(Loan, {
        annualInterestRateBps: 392,
        currencyKey: currency,
        includeInNetWorth: true,
        maturityDate: addMonths(seedToday, 340),
        name: demoLoans.mortgage.name,
        notes: 'Home loan tracked manually from the latest statement balance.',
        openingBalanceDate,
        openingPrincipalBalance: demoLoans.mortgage.openingPrincipalBalance,
        originalPrincipal: demoLoans.mortgage.originalPrincipal,
        ownerAppuserKey: appuser,
        paymentDayOfMonth: 1,
        paymentFrequency: LoanPaymentFrequency.MONTHLY,
        providerName: demoLoans.mortgage.providerName,
        rateType: LoanRateType.FIXED,
        regularPaymentAmount: demoLoans.mortgage.regularPaymentAmount,
        status: LoanStatus.ACTIVE,
        tenantKey: tenant,
        termMonths: 340,
        type: LoanType.MORTGAGE,
      });
      const autoLoan = em.create(Loan, {
        annualInterestRateBps: 650,
        currencyKey: currency,
        includeInNetWorth: true,
        maturityDate: addMonths(seedToday, 38),
        name: demoLoans.carLoan.name,
        openingBalanceDate,
        openingPrincipalBalance: demoLoans.carLoan.openingPrincipalBalance,
        originalPrincipal: demoLoans.carLoan.originalPrincipal,
        ownerAppuserKey: appuser,
        paymentDayOfMonth: 15,
        paymentFrequency: LoanPaymentFrequency.MONTHLY,
        providerName: demoLoans.carLoan.providerName,
        rateType: LoanRateType.FIXED,
        regularPaymentAmount: demoLoans.carLoan.regularPaymentAmount,
        status: LoanStatus.ACTIVE,
        tenantKey: tenant,
        termMonths: 38,
        type: LoanType.AUTO_LOAN,
      });
      const personalLoan = em.create(Loan, {
        annualInterestRateBps: 890,
        currencyKey: currency,
        includeInNetWorth: true,
        maturityDate: addMonths(seedToday, 22),
        name: 'Crédito pessoal',
        openingBalanceDate,
        openingPrincipalBalance: 3200,
        originalPrincipal: 5000,
        ownerAppuserKey: appuser,
        paymentDayOfMonth: 20,
        paymentFrequency: LoanPaymentFrequency.MONTHLY,
        providerName: 'Banco Pessoal',
        rateType: LoanRateType.FIXED,
        regularPaymentAmount: 152.4,
        status: LoanStatus.ACTIVE,
        tenantKey: tenant,
        termMonths: 22,
        type: LoanType.PERSONAL_LOAN,
      });

      loans.push(mortgage, autoLoan, personalLoan);

      const mortgagePayment = findMortgagePayment(ctx['transactions'], appuser, tenant);
      if (mortgagePayment) {
        const paymentDate = requireSeedDependency(
          mortgagePayment.transactionDate,
          `${user.appUser} mortgage payment date`,
        );
        repaymentLinks.push(
          em.create(LoanRepaymentLink, {
            allocationSource: LoanAllocationSource.MANUAL,
            loanKey: mortgage,
            feeAmount: 0,
            interestAmount: 280,
            linkedByAppuserKey: appuser,
            needsReview: false,
            notes: 'Seeded mortgage repayment split from bank transaction.',
            paymentDate,
            principalAmount: 320,
            tenantKey: tenant,
            totalPaymentAmount: 600,
            transactionKey: mortgagePayment,
          }),
        );
      }
    }

    await em.persist([...loans, ...repaymentLinks]).flush();
    ctx['loans'] = loans;
    ctx['loanRepaymentLinks'] = repaymentLinks;
  }
}

function findMortgagePayment(
  transactions: Transaction[] | undefined,
  appuser: Appuser,
  tenant: Tenant,
): Transaction | undefined {
  return transactions?.find(
    (transaction) =>
      transaction.appuserKey?.appuserKey === appuser.appuserKey &&
      transaction.tenantKey?.tenantKey === tenant.tenantKey &&
      transaction.description === 'Pag Empréstimo Hipoteca' &&
      transaction.settlementAmount != null &&
      transaction.settlementAmount < 0,
  );
}

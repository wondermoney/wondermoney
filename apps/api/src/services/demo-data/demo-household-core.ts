import type { EntityManager, EntityName, FilterQuery, RequiredEntityData } from '@mikro-orm/core';

import { demoBudget } from '@app/database/seeders/demo/demo-budget';
import { demoAccounts } from '@app/database/seeders/demo/demo-fixtures';
import { demoLoans } from '@app/database/seeders/demo/demo-loans';
import { demoPortfolios } from '@app/database/seeders/demo/demo-portfolio';
import { Account } from '@entity/Account';
import { AccountFinancialInstitution } from '@entity/AccountFinancialInstitution';
import type { Appuser } from '@entity/Appuser';
import { Budget } from '@entity/Budget';
import { Currency } from '@entity/Currency';
import { Loan } from '@entity/Loan';
import { NordigenRequisition } from '@entity/NordigenRequisition';
import { Portfolio } from '@entity/Portfolio';
import type { Tenant } from '@entity/Tenant';
import {
  LoanPaymentFrequency,
  LoanRateType,
  LoanStatus,
  LoanType,
} from '@service/loan/loan-types';

/**
 * The demo household's core objects, upserted from the seeder fixtures in `seeders/demo/`: its three
 * bank accounts, its budget, its portfolios and its two loans. Each is matched on the demo user and
 * its fixture name, so running this again changes nothing that is already in place, and nothing
 * outside the demo household is read or written. The caller flushes.
 *
 * Used by `demo:reset` (rebaseline an existing demo) and `demo:seed` (create or refresh one).
 */
export async function upsertDemoHouseholdCore(em: EntityManager, appuser: Appuser, tenant: Tenant): Promise<void> {
  const [eurCurrency, usdCurrency, actiBank, revolut] = await Promise.all([
    em.findOneOrFail(Currency, { code: 'EUR' }),
    em.findOneOrFail(Currency, { code: 'USD' }),
    em.findOneOrFail(AccountFinancialInstitution, { name: 'Banco ActivoBank' }),
    em.findOneOrFail(AccountFinancialInstitution, { name: 'Revolut' }),
  ]);

  const demoRequisition = await em.findOne(NordigenRequisition, { appuserKey: appuser });
  const sharedRefreshedAt = new Date('2040-01-01T00:00:00.000Z');
  await Promise.all([
    upsertByCriteria<Account>(
      em,
      Account,
      { accountId: demoAccounts.current.accountId, accountOwnerAppuserKey: appuser },
      {
        accountFinancialInstitutionKey: actiBank,
        accountId: demoAccounts.current.accountId,
        accountName: demoAccounts.current.accountName,
        accountNumber: demoAccounts.current.accountNumber,
        accountOwnerAppuserKey: appuser,
        appuserCurrencyBalance: demoAccounts.current.balance,
        balance: demoAccounts.current.balance,
        currencyKey: eurCurrency,
        holderName: demoAccounts.current.holderName,
        nordigenRequisitionKey: demoRequisition ?? undefined,
        refreshedAt: sharedRefreshedAt,
        tenantKey: tenant,
      },
    ),
    upsertByCriteria<Account>(
      em,
      Account,
      { accountId: demoAccounts.usd.accountId, accountOwnerAppuserKey: appuser },
      {
        accountFinancialInstitutionKey: revolut,
        accountId: demoAccounts.usd.accountId,
        accountName: demoAccounts.usd.accountName,
        accountNumber: demoAccounts.usd.accountNumber,
        accountOwnerAppuserKey: appuser,
        appuserCurrencyBalance: demoAccounts.usd.balance * 0.94,
        balance: demoAccounts.usd.balance,
        currencyKey: usdCurrency,
        holderName: demoAccounts.usd.holderName,
        nordigenRequisitionKey: demoRequisition ?? undefined,
        refreshedAt: sharedRefreshedAt,
        tenantKey: tenant,
      },
    ),
    upsertByCriteria<Account>(
      em,
      Account,
      { accountId: demoAccounts.savings.accountId, accountOwnerAppuserKey: appuser },
      {
        accountFinancialInstitutionKey: actiBank,
        accountId: demoAccounts.savings.accountId,
        accountName: demoAccounts.savings.accountName,
        accountNumber: demoAccounts.savings.accountNumber,
        accountOwnerAppuserKey: appuser,
        appuserCurrencyBalance: demoAccounts.savings.balance,
        balance: demoAccounts.savings.balance,
        currencyKey: eurCurrency,
        holderName: demoAccounts.savings.holderName,
        nordigenRequisitionKey: demoRequisition ?? undefined,
        refreshedAt: sharedRefreshedAt,
        tenantKey: tenant,
      },
    ),
  ]);
  await upsertByCriteria<Budget>(
    em,
    Budget,
    { appuserKey: appuser, name: demoBudget.name },
    {
      appuserKey: appuser,
      currencyKey: eurCurrency,
      description: demoBudget.description,
      name: demoBudget.name,
      numAdults: demoBudget.numAdults,
      numDependents: demoBudget.numDependents,
      // Budgets belong to the household; a budget created here (on a new demo) needs it.
      tenantKey: tenant,
    },
  );
  await Promise.all(
    demoPortfolios.map((portfolio) =>
      upsertByCriteria<Portfolio>(
        em,
        Portfolio,
        { name: portfolio.name, portfolioOwnerAppuserKey: appuser },
        {
          currencyKey: portfolio.currency === 'USD' ? usdCurrency : eurCurrency,
          description: portfolio.description,
          name: portfolio.name,
          portfolioOwnerAppuserKey: appuser,
          tenantKey: tenant,
        },
      ),
    ),
  );
  await Promise.all([
    upsertByCriteria<Loan>(
      em,
      Loan,
      { name: demoLoans.mortgage.name, ownerAppuserKey: appuser },
      {
        annualInterestRateBps: 392,
        currencyKey: eurCurrency,
        includeInNetWorth: true,
        maturityDate: new Date('2050-01-01T00:00:00.000Z'),
        name: demoLoans.mortgage.name,
        openingBalanceDate: new Date('2024-01-01T00:00:00.000Z'),
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
      },
    ),
    upsertByCriteria<Loan>(
      em,
      Loan,
      { name: demoLoans.carLoan.name, ownerAppuserKey: appuser },
      {
        annualInterestRateBps: 650,
        currencyKey: eurCurrency,
        includeInNetWorth: true,
        maturityDate: new Date('2030-01-01T00:00:00.000Z'),
        name: demoLoans.carLoan.name,
        openingBalanceDate: new Date('2024-01-01T00:00:00.000Z'),
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
      },
    ),
  ]);

}

async function upsertByCriteria<T extends object>(
  em: EntityManager,
  entity: EntityName<T>,
  criteria: FilterQuery<NoInfer<T>>,
  data: object,
) {
  const existing = await em.findOne<T>(entity, criteria);

  if (existing) {
    em.assign(existing, data);
    return existing;
  }

  return em.create(entity, data as RequiredEntityData<T>);
}

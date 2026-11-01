import { type EntityManager, type EntityName, type FilterQuery, MikroORM, type RequiredEntityData } from '@mikro-orm/core';

import { Account } from '@entity/Account';
import { AccountFinancialInstitution } from '@entity/AccountFinancialInstitution';
import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { BackgroundOperation, BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { Budget } from '@entity/Budget';
import { Currency } from '@entity/Currency';
import { Loan } from '@entity/Loan';
import { NordigenRequisition } from '@entity/NordigenRequisition';
import { Portfolio } from '@entity/Portfolio';
import { Tenant, TenantType } from '@entity/Tenant';
import { TransactionOCRImport, TransactionOCRImportStatus } from '@entity/TransactionOCRImport';
import {
  LoanPaymentFrequency,
  LoanRateType,
  LoanStatus,
  LoanType,
} from '@service/loan/loan-types';

import config from '../../mikro-orm.config';
import { demoBudget } from '../seeders/demo/demo-budget';
import { demoAccounts } from '../seeders/demo/demo-fixtures';
import { demoPersona } from '../seeders/demo/demo-fixtures';
import { demoLoans } from '../seeders/demo/demo-loans';
import { demoPortfolios } from '../seeders/demo/demo-portfolio';

import {
  assertDemoResetPreflight,
  buildResetInvariantSummary,
  ensureSingleDemoEntity,
} from './reset-demo-data.helpers';

async function main() {
  const orm = await MikroORM.init(config);
  const em = orm.em.fork();

  try {
    await em.transactional(async (tx) => {
      const demoAppuser = ensureSingleDemoEntity(
        await tx.find(Appuser, {
          accountType: AppuserAccountType.DEMO,
          deletedAt: null,
          emailAddress: demoPersona.email,
          recordActive: true,
        }),
        'demo appuser',
      );
      const demoTenant = ensureSingleDemoEntity(
        await tx.find(
          Tenant,
          {
            name: demoPersona.householdName,
            recordActive: true,
            tenantType: TenantType.DEMO,
          },
          { populate: ['ownerAppuserKey'] },
        ),
        'demo tenant',
      );

      if (demoTenant.ownerAppuserKey.appuserKey !== demoAppuser.appuserKey) {
        throw new Error('Demo tenant owner does not match demo appuser');
      }

      const [pendingImports, pendingOperations] = await Promise.all([
        tx.count(TransactionOCRImport, { status: TransactionOCRImportStatus.STARTED, tenantKey: demoTenant }),
        tx.count(BackgroundOperation, {
          status: { $in: [BackgroundOperationStatus.QUEUED, BackgroundOperationStatus.RUNNING] },
          tenantKey: demoTenant,
        }),
      ]);
      assertDemoResetPreflight({ pendingImports, pendingOperations });

      // Public demo guards already prevent destructive writes; this command only
      // rebaselines core demo objects and leaves transaction history/imports intact.
      const demoLinks = await tx.find(
        AppuserTenant,
        {
          $or: [{ appuserKey: demoAppuser }, { tenantKey: demoTenant }],
          deletedAt: null,
          recordActive: true,
        },
        { populate: ['appuserKey', 'tenantKey'] },
      );
      const demoLink = ensureSingleDemoEntity(
        demoLinks.filter(
          (link) =>
            link.appuserKey.appuserKey === demoAppuser.appuserKey && link.tenantKey.tenantKey === demoTenant.tenantKey,
        ),
        'demo appuser-tenant link',
      );

      const [eurCurrency, usdCurrency, actiBank, revolut] = await Promise.all([
        tx.findOneOrFail(Currency, { code: 'EUR' }),
        tx.findOneOrFail(Currency, { code: 'USD' }),
        tx.findOneOrFail(AccountFinancialInstitution, { name: 'Banco ActivoBank' }),
        tx.findOneOrFail(AccountFinancialInstitution, { name: 'Revolut' }),
      ]);

      const demoRequisition = await tx.findOne(NordigenRequisition, { appuserKey: demoAppuser });
      const sharedRefreshedAt = new Date('2040-01-01T00:00:00.000Z');
      await Promise.all([
        upsertByCriteria<Account>(
          tx,
          Account,
          { accountId: demoAccounts.current.accountId, accountOwnerAppuserKey: demoAppuser },
          {
            accountFinancialInstitutionKey: actiBank,
            accountId: demoAccounts.current.accountId,
            accountName: demoAccounts.current.accountName,
            accountNumber: demoAccounts.current.accountNumber,
            accountOwnerAppuserKey: demoAppuser,
            appuserCurrencyBalance: demoAccounts.current.balance,
            balance: demoAccounts.current.balance,
            currencyKey: eurCurrency,
            holderName: demoAccounts.current.holderName,
            nordigenRequisitionKey: demoRequisition ?? undefined,
            refreshedAt: sharedRefreshedAt,
            tenantKey: demoTenant,
          },
        ),
        upsertByCriteria<Account>(
          tx,
          Account,
          { accountId: demoAccounts.usd.accountId, accountOwnerAppuserKey: demoAppuser },
          {
            accountFinancialInstitutionKey: revolut,
            accountId: demoAccounts.usd.accountId,
            accountName: demoAccounts.usd.accountName,
            accountNumber: demoAccounts.usd.accountNumber,
            accountOwnerAppuserKey: demoAppuser,
            appuserCurrencyBalance: demoAccounts.usd.balance * 0.94,
            balance: demoAccounts.usd.balance,
            currencyKey: usdCurrency,
            holderName: demoAccounts.usd.holderName,
            nordigenRequisitionKey: demoRequisition ?? undefined,
            refreshedAt: sharedRefreshedAt,
            tenantKey: demoTenant,
          },
        ),
        upsertByCriteria<Account>(
          tx,
          Account,
          { accountId: demoAccounts.savings.accountId, accountOwnerAppuserKey: demoAppuser },
          {
            accountFinancialInstitutionKey: actiBank,
            accountId: demoAccounts.savings.accountId,
            accountName: demoAccounts.savings.accountName,
            accountNumber: demoAccounts.savings.accountNumber,
            accountOwnerAppuserKey: demoAppuser,
            appuserCurrencyBalance: demoAccounts.savings.balance,
            balance: demoAccounts.savings.balance,
            currencyKey: eurCurrency,
            holderName: demoAccounts.savings.holderName,
            nordigenRequisitionKey: demoRequisition ?? undefined,
            refreshedAt: sharedRefreshedAt,
            tenantKey: demoTenant,
          },
        ),
      ]);
      await upsertByCriteria<Budget>(
        tx,
        Budget,
        { appuserKey: demoAppuser, name: demoBudget.name },
        {
          appuserKey: demoAppuser,
          currencyKey: eurCurrency,
          description: demoBudget.description,
          name: demoBudget.name,
          numAdults: demoBudget.numAdults,
          numDependents: demoBudget.numDependents,
        },
      );
      await Promise.all(
        demoPortfolios.map((portfolio) =>
          upsertByCriteria<Portfolio>(
            tx,
            Portfolio,
            { name: portfolio.name, portfolioOwnerAppuserKey: demoAppuser },
            {
              currencyKey: portfolio.currency === 'USD' ? usdCurrency : eurCurrency,
              description: portfolio.description,
              name: portfolio.name,
              portfolioOwnerAppuserKey: demoAppuser,
              tenantKey: demoTenant,
            },
          ),
        ),
      );
      await Promise.all([
        upsertByCriteria<Loan>(
          tx,
          Loan,
          { name: demoLoans.mortgage.name, ownerAppuserKey: demoAppuser },
          {
            annualInterestRateBps: 392,
            currencyKey: eurCurrency,
            includeInNetWorth: true,
            maturityDate: new Date('2050-01-01T00:00:00.000Z'),
            name: demoLoans.mortgage.name,
            openingBalanceDate: new Date('2024-01-01T00:00:00.000Z'),
            openingPrincipalBalance: demoLoans.mortgage.openingPrincipalBalance,
            originalPrincipal: demoLoans.mortgage.originalPrincipal,
            ownerAppuserKey: demoAppuser,
            paymentDayOfMonth: 1,
            paymentFrequency: LoanPaymentFrequency.MONTHLY,
            providerName: demoLoans.mortgage.providerName,
            rateType: LoanRateType.FIXED,
            regularPaymentAmount: demoLoans.mortgage.regularPaymentAmount,
            status: LoanStatus.ACTIVE,
            tenantKey: demoTenant,
            termMonths: 340,
            type: LoanType.MORTGAGE,
          },
        ),
        upsertByCriteria<Loan>(
          tx,
          Loan,
          { name: demoLoans.carLoan.name, ownerAppuserKey: demoAppuser },
          {
            annualInterestRateBps: 650,
            currencyKey: eurCurrency,
            includeInNetWorth: true,
            maturityDate: new Date('2030-01-01T00:00:00.000Z'),
            name: demoLoans.carLoan.name,
            openingBalanceDate: new Date('2024-01-01T00:00:00.000Z'),
            openingPrincipalBalance: demoLoans.carLoan.openingPrincipalBalance,
            originalPrincipal: demoLoans.carLoan.originalPrincipal,
            ownerAppuserKey: demoAppuser,
            paymentDayOfMonth: 15,
            paymentFrequency: LoanPaymentFrequency.MONTHLY,
            providerName: demoLoans.carLoan.providerName,
            rateType: LoanRateType.FIXED,
            regularPaymentAmount: demoLoans.carLoan.regularPaymentAmount,
            status: LoanStatus.ACTIVE,
            tenantKey: demoTenant,
            termMonths: 38,
            type: LoanType.AUTO_LOAN,
          },
        ),
      ]);

      await tx.flush();

      const [
        accounts,
        budgets,
        loans,
        portfolios,
        activeLinkCount,
        appuserLinkCount,
        tenantLinkCount,
      ] = await Promise.all([
        tx.count(Account, { tenantKey: demoTenant }),
        tx.count(Budget, { appuserKey: demoAppuser }),
        tx.count(Loan, { tenantKey: demoTenant }),
        tx.count(Portfolio, { tenantKey: demoTenant }),
        tx.count(AppuserTenant, {
          appuserKey: demoAppuser,
          deletedAt: null,
          recordActive: true,
          tenantKey: demoTenant,
        }),
        tx.count(AppuserTenant, { appuserKey: demoAppuser, deletedAt: null, recordActive: true }),
        tx.count(AppuserTenant, { deletedAt: null, recordActive: true, tenantKey: demoTenant }),
      ]);

      const summary = buildResetInvariantSummary({
        accounts,
        budgets,
        loans,
        pendingImports,
        pendingOperations,
        portfolios,
      });

      if (!summary.hasAtLeastTwoDemoAccounts || !summary.hasBudget || !summary.hasLoan || !summary.hasPortfolio) {
        throw new Error(`Demo reset invariants failed: ${JSON.stringify(summary)}`);
      }

      if (activeLinkCount !== 1 || appuserLinkCount !== 1 || tenantLinkCount !== 1) {
        throw new Error(
          `Demo identity invariants failed: ${JSON.stringify({
            activeLinkCount,
            appuserLinkCount,
            tenantLinkCount,
          })}`,
        );
      }

      console.log('Demo reset complete.', {
        demoAppuser: demoAppuser.appuserKey,
        demoLink: demoLink.appuserTenantKey,
        demoTenant: demoTenant.tenantKey,
        summary,
      });
    });
  } finally {
    await orm.close(true);
  }
}

async function upsertByCriteria<T extends object>(
  tx: EntityManager,
  entity: EntityName<T>,
  criteria: FilterQuery<NoInfer<T>>,
  data: object,
) {
  const existing = await tx.findOne<T>(entity, criteria);

  if (existing) {
      tx.assign(existing, data);
    return existing;
  }

  return tx.create(entity, data as RequiredEntityData<T>);
}

void main();

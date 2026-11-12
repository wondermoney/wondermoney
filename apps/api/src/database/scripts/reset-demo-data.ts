import { MikroORM } from '@mikro-orm/core';

import { Account } from '@entity/Account';
import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { BackgroundOperation, BackgroundOperationStatus } from '@entity/BackgroundOperation';
import { Budget } from '@entity/Budget';
import { Loan } from '@entity/Loan';
import { Portfolio } from '@entity/Portfolio';
import { Tenant, TenantType } from '@entity/Tenant';
import { TransactionOCRImport, TransactionOCRImportStatus } from '@entity/TransactionOCRImport';
import { upsertDemoHouseholdCore } from '@service/demo-data/demo-household-core';

import config from '../../mikro-orm.config';
import { demoPersona } from '../seeders/demo/demo-fixtures';

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

      await upsertDemoHouseholdCore(tx, demoAppuser, demoTenant);

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

void main();

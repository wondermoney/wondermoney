import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addPartner, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import type { Household } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { addExchangeRate, seedPortfolio } from '@app/__tests__/__helpers__/portfolio-fixtures';
import type { PortfolioSetup } from '@app/__tests__/__helpers__/portfolio-fixtures';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { DI } from '@app/database/di';
import { Appuser } from '@entity/Appuser';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { PortfolioImportSession } from '@entity/PortfolioImportSession';
import { NotFoundError } from '@utils/errors';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../stock-split-sync.service', async (importOriginal) => ({ ...(await importOriginal<object>()), syncStockSplitsForAsset: vi.fn() }));
vi.mock('../portfolio-snapshot.service', () => ({ default: { backfillSnapshotsForPortfolio: vi.fn() } }));
vi.mock('../asset-price.service', async (importOriginal) => {
  const original = (await importOriginal<{ default: object }>()).default;
  return { default: Object.assign(Object.create(original) as object, { ensureRecentAssetPrice: vi.fn() }) };
});

import portfolioImportSessionService from '../portfolio-import-session.service';
import portfolioTransactionService from '../portfolio-transaction.service';

/*
 * A tenant is a household that shares its portfolios. With a resolved tenant (request paths)
 * any member may add, edit and delete transactions on any of the household's portfolios, and a
 * user from another household gets 404. Without a tenant (worker paths) only the owner may.
 */
describe('portfolio writes across a household', () => {
  const db = useTestDatabase();
  const deps = { enqueue: { send: vi.fn(), sendAfter: vi.fn() } };

  interface Scenario {
    household: Household;
    outsider: Appuser;
    outsiderTenantKey: number;
    owner: Appuser;
    partner: Appuser;
    setup: PortfolioSetup;
    tenantKey: number;
  }
  let scenario: Scenario;

  beforeEach(async () => {
    const household = await seedHousehold(db.em());
    const partner = await addPartner(db.em(), household);
    const other = await seedHousehold(db.em());
    const setup = await seedPortfolio(DI.em, household);
    const load = (appuserKey: number) => setup.em.findOneOrFail(Appuser, { appuserKey }, { filters: false, populate: ['currencyKey'] });
    scenario = {
      household,
      outsider: await load(other.appuser.appuserKey),
      outsiderTenantKey: other.tenant.tenantKey,
      owner: setup.appuser,
      partner: await load(partner.appuserKey),
      setup,
      tenantKey: household.tenant.tenantKey,
    };
  });

  type CreateParams = Parameters<typeof portfolioTransactionService.createPortfolioTransaction>[1];

  const create = (appuser: Appuser, overrides: Partial<CreateParams> = {}) =>
    portfolioTransactionService.createPortfolioTransaction(appuser, {
      assetSymbol: scenario.setup.asset.symbol,
      financialAsset: scenario.setup.asset,
      financialTransactionTypeId: FINANCIAL_TRANSACTION_TYPES.BUY,
      portfolioId: scenario.setup.portfolio.portfolioKey,
      quantity: 10,
      settlementCurrencyId: scenario.household.currency.currencyKey,
      skipMaintenance: true,
      transactionDate: new Date('2026-07-17T00:00:00Z'),
      unitPrice: 100,
      ...overrides,
    }, scenario.setup.em);

  const stored = () => db.em().find(FinancialTransaction, {}, { filters: false, orderBy: { transactionKey: 'ASC' } });

  async function ownerBuy(): Promise<FinancialTransaction> {
    await create(scenario.owner, { tenantId: scenario.tenantKey });
    const [buy] = await stored();
    return buy!;
  }

  const ownerSell = (quantity: number) => create(scenario.owner, {
    financialTransactionTypeId: FINANCIAL_TRANSACTION_TYPES.SELL,
    quantity,
    tenantId: scenario.tenantKey,
    transactionDate: new Date('2026-07-20T00:00:00Z'),
  });

  describe('create', () => {
    it("lets a partner add a transaction to the owner's portfolio", async () => {
      await create(scenario.partner, { tenantId: scenario.tenantKey });

      const rows = await stored();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.portfolioKey?.portfolioKey).toBe(scenario.setup.portfolio.portfolioKey);
      // Kept under the portfolio's owner, so his owner-scoped snapshots and worker reads count it.
      expect(rows[0]!.appuserKey?.appuserKey).toBe(scenario.owner.appuserKey);
    });

    it("converts a partner's trade into the portfolio owner's currency, not the partner's", async () => {
      // The partner keeps dollars; the owner, and the portfolio's snapshots, are in euros.
      scenario.partner.currencyKey = scenario.setup.usd;
      await addExchangeRate(scenario.setup.em, scenario.setup.usd, scenario.household.currency, '2026-07-17', 0.9);

      await create(scenario.partner, { settlementCurrencyId: scenario.setup.usd.currencyKey, tenantId: scenario.tenantKey });

      const [row] = await stored();
      expect(Number(row!.appuserSettlementAmount)).toBeCloseTo(900);
    });

    it("lets a partner sell against the owner's buys in the same portfolio", async () => {
      await ownerBuy();

      await create(scenario.partner, {
        financialTransactionTypeId: FINANCIAL_TRANSACTION_TYPES.SELL,
        quantity: 4,
        tenantId: scenario.tenantKey,
        transactionDate: new Date('2026-07-20T00:00:00Z'),
      });

      expect(await stored()).toHaveLength(2);
    });

    it('returns 404 to a user from another household', async () => {
      await expect(create(scenario.outsider, { tenantId: scenario.outsiderTenantKey })).rejects.toBeInstanceOf(NotFoundError);
      expect(await stored()).toHaveLength(0);
    });

    it('returns 404 to a user naming a household they are not a member of', async () => {
      await expect(create(scenario.outsider, { tenantId: scenario.tenantKey })).rejects.toBeInstanceOf(NotFoundError);
      expect(await stored()).toHaveLength(0);
    });

    it("keeps owner-only without a tenant: the partner can't write, the owner can", async () => {
      await expect(create(scenario.partner)).rejects.toBeInstanceOf(NotFoundError);
      expect(await stored()).toHaveLength(0);

      await create(scenario.owner);
      expect(await stored()).toHaveLength(1);
    });
  });

  describe('update', () => {
    const update = (appuser: Appuser, transactionKey: number, tenantKey?: number) =>
      portfolioTransactionService.updatePortfolioTransaction(appuser, scenario.setup.portfolio.portfolioKey, transactionKey, { notes: 'rebalanced' }, deps, tenantKey);

    it("lets a partner edit a transaction on the owner's portfolio", async () => {
      const buy = await ownerBuy();

      await update(scenario.partner, buy.transactionKey, scenario.tenantKey);

      const [row] = await stored();
      expect(row!.notes).toBe('rebalanced');
    });

    it("lets a partner edit the owner's sell, checked against the owner's buys", async () => {
      await ownerBuy();
      await ownerSell(4);
      const [, sell] = await stored();

      await update(scenario.partner, sell!.transactionKey, scenario.tenantKey);

      const [, row] = await stored();
      expect(row!.notes).toBe('rebalanced');
    });

    it('returns 404 to a user from another household', async () => {
      const buy = await ownerBuy();

      await expect(update(scenario.outsider, buy.transactionKey, scenario.outsiderTenantKey)).rejects.toBeInstanceOf(NotFoundError);
      const [row] = await stored();
      expect(row!.notes).toBeFalsy();
    });

    it("keeps owner-only without a tenant: the partner can't edit", async () => {
      const buy = await ownerBuy();

      await expect(update(scenario.partner, buy.transactionKey)).rejects.toBeInstanceOf(NotFoundError);
      const [row] = await stored();
      expect(row!.notes).toBeFalsy();
    });
  });

  describe('delete', () => {
    const remove = (appuser: Appuser, transactionKey: number, tenantKey?: number) =>
      portfolioTransactionService.deletePortfolioTransaction(appuser, scenario.setup.portfolio.portfolioKey, transactionKey, tenantKey);

    it("lets a partner delete a transaction on the owner's portfolio", async () => {
      const buy = await ownerBuy();

      await remove(scenario.partner, buy.transactionKey, scenario.tenantKey);

      const [row] = await stored();
      expect(row!.deletedAt).toBeInstanceOf(Date);
    });

    it("refuses a partner's delete that would oversell the owner's sells", async () => {
      const buy = await ownerBuy();
      await ownerSell(5);

      await expect(remove(scenario.partner, buy.transactionKey, scenario.tenantKey)).rejects.toThrow('Sell quantity exceeds available holdings for this portfolio');
      const [row] = await stored();
      expect(row!.deletedAt).toBeFalsy();
    });

    it('returns 404 to a user from another household', async () => {
      const buy = await ownerBuy();

      await expect(remove(scenario.outsider, buy.transactionKey, scenario.outsiderTenantKey)).rejects.toBeInstanceOf(NotFoundError);
      const [row] = await stored();
      expect(row!.deletedAt).toBeFalsy();
    });

    it("keeps owner-only without a tenant: the partner can't delete", async () => {
      const buy = await ownerBuy();

      await expect(remove(scenario.partner, buy.transactionKey)).rejects.toBeInstanceOf(NotFoundError);
      const [row] = await stored();
      expect(row!.deletedAt).toBeFalsy();
    });
  });

  describe('CSV import', () => {
    const startImport = (appuser: Appuser, tenantKey: number) => portfolioImportSessionService.createSession({
      appuser,
      correlationId: `portfolio.csv-import-session:${scenario.setup.portfolio.portfolioKey}:test`,
      portfolioId: scenario.setup.portfolio.portfolioKey,
      s3Bucket: 'portfolios-csv-test',
      s3Key: 'portfolio-import-sessions/test.csv',
      tenant: { tenantKey },
    });
    const sessions = () => db.em().find(PortfolioImportSession, {}, { filters: false });

    it("lets a partner import into the owner's portfolio, as the partner's own session", async () => {
      await startImport(scenario.partner, scenario.tenantKey);

      const [session] = await sessions();
      expect(session!.portfolioKey.portfolioKey).toBe(scenario.setup.portfolio.portfolioKey);
      expect(session!.appuserKey.appuserKey).toBe(scenario.partner.appuserKey);
    });

    it('returns 404 to a user from another household', async () => {
      await expect(startImport(scenario.outsider, scenario.outsiderTenantKey)).rejects.toBeInstanceOf(NotFoundError);
      expect(await sessions()).toHaveLength(0);
    });
  });
});

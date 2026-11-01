import { describe, expect, it, vi } from 'vitest';

import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { DI } from '@app/database/di';
import { FinancialBroker } from '@entity/FinancialBroker';
import { PortfolioImportParserSpec, PortfolioImportParserSpecScope, PortfolioImportParserSpecSource, PortfolioImportParserSpecStatus } from '@entity/PortfolioImportParserSpec';
import { Tenant } from '@entity/Tenant';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import service, { buildPortfolioCsvShapeFingerprint, buildPortfolioImportParserSpecPayload, hashPortfolioImportParserSpecPayload, PORTFOLIO_IMPORT_SPEC_ENGINE_VERSION, PORTFOLIO_IMPORT_SPEC_SCHEMA_VERSION } from '../portfolio-import-parser-spec.service';

const RUNS = 4;
/** A rejected run reads as the constraint it broke, so a failure names the race rather than dumping the insert. */
const outcome = <T>(result: PromiseSettledResult<T>) => result.status === 'fulfilled' ? result.value : `rejected: ${(result.reason as { constraint?: string }).constraint ?? String(result.reason)}`;
const headers = ['Date', 'Type', 'Ticker', 'Quantity', 'Price'];
const layout = { dataStartRowIndex: 1, headerRowIndex: 0 };
const columnMapping = { assetName: 'Ticker', quantity: 'Quantity', transactionDate: 'Date', transactionType: 'Type', unitPrice: 'Price' };

/*
 * Two members of a household can confirm the same CSV layout at once, and two households can
 * finish an import of the same broker layout at once. Each path reads the existing spec and then
 * writes, so it relies on an advisory lock held until its transaction commits. Two sessions
 * contending need a real server; PGlite is a single backend (see `pg-test-db.ts`).
 */
// The runs themselves take milliseconds; the timeout leaves room for seeding on a loaded CI server.
describe.runIf(process.env['TEST_POSTGRES_URL'])('portfolio import parser specs under concurrent writes', { timeout: 30_000 }, () => {
  const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'] });

  const activeSpecs = (scope: PortfolioImportParserSpecScope) => db.em().find(PortfolioImportParserSpec, { scope, status: PortfolioImportParserSpecStatus.ACTIVE });

  it('keeps one active tenant spec when the same layout without a broker is confirmed several times at once', async () => {
    const household = await seedHousehold(db.em());
    const input = { appuser: household.appuser, columnMapping, headers, layout, suggestionSource: 'user' as const, tenant: household.tenant, transformations: {} };

    const saved = await Promise.all(Array.from({ length: RUNS }, () => service.saveConfirmedSpec(input)));

    const active = await activeSpecs(PortfolioImportParserSpecScope.TENANT);
    expect(active).toHaveLength(1);
    expect(new Set(saved.map((spec) => spec.portfolioImportParserSpecKey))).toEqual(new Set(active.map((spec) => spec.portfolioImportParserSpecKey)));
  });

  it('saves every confirmation of the same broker layout made at once', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const broker = em.create(FinancialBroker, { displayName: 'Broker', name: 'broker' }, { partial: true });
    await em.flush();
    const input = { appuser: household.appuser, broker, columnMapping, headers, layout, suggestionSource: 'user' as const, tenant: household.tenant, transformations: {} };

    const results = await Promise.allSettled(Array.from({ length: RUNS }, () => service.saveConfirmedSpec(input)));

    expect(results.map(outcome).filter((value) => typeof value === 'string')).toEqual([]);
    await expect(activeSpecs(PortfolioImportParserSpecScope.TENANT)).resolves.toHaveLength(1);
  });

  it('promotes one global spec when several households finish the same broker layout at once', async () => {
    const em = db.em();
    const household = await seedHousehold(em);
    const broker = em.create(FinancialBroker, { displayName: 'Broker', name: 'broker' }, { partial: true });
    const tenants = [household.tenant, ...Array.from({ length: RUNS - 1 }, () => em.create(Tenant, { ownerAppuserKey: household.appuser, tentantStatusKey: household.tenant.tentantStatusKey }, { partial: true }))];
    await em.flush();
    const fingerprint = buildPortfolioCsvShapeFingerprint({ headers, layout });
    const payload = buildPortfolioImportParserSpecPayload({ columnMapping, headers, layout, transformations: {} });
    const contentHash = hashPortfolioImportParserSpecPayload(payload);
    const candidates = tenants.map((tenant) => em.create(PortfolioImportParserSpec, {
      contentHash,
      engineVersion: PORTFOLIO_IMPORT_SPEC_ENGINE_VERSION,
      financialBrokerKey: broker,
      headerOrderHash: fingerprint.headerOrderHash,
      headerSetHash: fingerprint.headerSetHash,
      normalizedHeadersJson: fingerprint.normalizedHeaders,
      schemaVersion: PORTFOLIO_IMPORT_SPEC_SCHEMA_VERSION,
      scope: PortfolioImportParserSpecScope.TENANT,
      shapeHash: fingerprint.shapeHash,
      source: PortfolioImportParserSpecSource.USER_CONFIRMED,
      specJson: payload,
      tenantKey: tenant,
    }, { partial: true }));
    await em.flush();

    // The import finalizer runs each promotion in its own transaction.
    const results = await Promise.allSettled(candidates.map((candidate) => DI.em.fork().transactional((txEm) => service.promoteTenantSpec({ expectedBrokerKey: broker.financialBrokerKey, expectedContentHash: contentHash, expectedTenantKey: candidate.tenantKey?.tenantKey ?? 0, parserSpecKey: candidate.portfolioImportParserSpecKey }, txEm))));

    expect(results.map((result) => { const value = outcome(result); return typeof value === 'string' ? value : value.status; })).toEqual(Array(RUNS).fill('promoted'));
    const globals = await activeSpecs(PortfolioImportParserSpecScope.GLOBAL);
    expect(globals.map((spec) => spec.successCount)).toEqual([RUNS]);
  });
});

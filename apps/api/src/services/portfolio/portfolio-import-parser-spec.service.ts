import { createHash } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/core';
import { z } from 'zod';

import { DI } from '@app/database/di';
import type { Appuser } from '@entity/Appuser';
import type { FinancialBroker } from '@entity/FinancialBroker';
import { PortfolioImportParserSpec, PortfolioImportParserSpecScope, PortfolioImportParserSpecSource, PortfolioImportParserSpecStatus } from '@entity/PortfolioImportParserSpec';
import type { Tenant } from '@entity/Tenant';
import logger from '@utils/logger';

import { type PortfolioColumnMapping, portfolioColumnMappingFields, type PortfolioColumnMappingTransformations, portfolioColumnMappingTransformationsSchema, type PortfolioCsvLayout, portfolioCsvLayoutSchema, type PortfolioImportDerivedValues, portfolioImportDerivedValuesSchema, type PortfolioImportFixedValues, portfolioImportFixedValuesSchema, validateConfirmedPortfolioColumnMapping } from './portfolio-csv-column-mapping.schema';
import { normalizeCsvHeader } from './portfolio-csv-layout.utils';

export const PORTFOLIO_IMPORT_SPEC_ENGINE_VERSION = 'portfolio-column-mapping-v2';
export const PORTFOLIO_IMPORT_SPEC_SCHEMA_VERSION = 2;

export interface PortfolioSpecColumnReference {
  normalizedHeader: string;
  occurrence?: number;
}

const columnReferenceSchema = z.object({ normalizedHeader: z.string().min(1).max(255), occurrence: z.number().int().min(0).optional() }).strict();
const columnsSchema = z.partialRecord(z.enum(portfolioColumnMappingFields), columnReferenceSchema);
const fixedValueOriginsSchema = z.object({ currency: z.literal('embedded_header').optional() }).strict();
export const portfolioImportParserSpecPayloadSchema = z.object({
  columns: columnsSchema,
  derivedValues: portfolioImportDerivedValuesSchema,
  fixedValueOrigins: fixedValueOriginsSchema,
  fixedValues: portfolioImportFixedValuesSchema,
  layout: portfolioCsvLayoutSchema,
  parser: z.literal('column-mapping-v2'),
  transformations: portfolioColumnMappingTransformationsSchema,
}).strict();
export type PortfolioImportParserSpecPayload = z.infer<typeof portfolioImportParserSpecPayloadSchema>;

interface PromoteTenantSpecInput { expectedBrokerKey: number; expectedContentHash: string; expectedTenantKey: number; parserSpecKey: number }
interface PromoteTenantSpecResult { globalParserSpecKey?: number; status: 'conflict' | 'ineligible' | 'promoted' }

class PortfolioImportParserSpecService {
  async findActiveSpecForShape(input: { appuser: Appuser; broker?: { financialBrokerKey: number }; headers: string[]; layout: PortfolioCsvLayout; tenant: { tenantKey: number } }): Promise<PortfolioImportParserSpec | undefined> {
    const fingerprint = buildPortfolioCsvShapeFingerprint(input);
    const brokerFilter = input.broker ? { financialBrokerKey: input.broker.financialBrokerKey } : null;
    const scopes = input.broker
      ? [
          { appuserKey: { appuserKey: input.appuser.appuserKey }, financialBrokerKey: brokerFilter, scope: PortfolioImportParserSpecScope.USER, tenantKey: { tenantKey: input.tenant.tenantKey } },
          { financialBrokerKey: brokerFilter, scope: PortfolioImportParserSpecScope.TENANT, tenantKey: { tenantKey: input.tenant.tenantKey } },
          { financialBrokerKey: brokerFilter, scope: PortfolioImportParserSpecScope.GLOBAL },
        ]
      : [
          { appuserKey: { appuserKey: input.appuser.appuserKey }, financialBrokerKey: null, scope: PortfolioImportParserSpecScope.USER, tenantKey: { tenantKey: input.tenant.tenantKey } },
          { financialBrokerKey: null, scope: PortfolioImportParserSpecScope.TENANT, tenantKey: { tenantKey: input.tenant.tenantKey } },
        ];
    const specs = await DI.em.find(PortfolioImportParserSpec, { $or: scopes, deletedAt: undefined, engineVersion: PORTFOLIO_IMPORT_SPEC_ENGINE_VERSION, headerSetHash: fingerprint.headerSetHash, schemaVersion: PORTFOLIO_IMPORT_SPEC_SCHEMA_VERSION, shapeHash: fingerprint.shapeHash, status: PortfolioImportParserSpecStatus.ACTIVE });
    const scopeRank = (spec: PortfolioImportParserSpec) => spec.scope === PortfolioImportParserSpecScope.USER ? 0 : spec.scope === PortfolioImportParserSpecScope.TENANT ? 1 : 2;
    const ordered = specs.sort((a, b) => scopeRank(a) - scopeRank(b) || b.specVersion - a.specVersion || b.updatedAt.getTime() - a.updatedAt.getTime());
    for (const spec of ordered) {
      try {
        const payload = parsePortfolioImportParserSpecPayload(spec.specJson);
        const columnMapping = resolveSpecColumnMapping({ actualHeaders: input.headers, columns: payload.columns });
        validateConfirmedPortfolioColumnMapping({ columnMapping, derivedValues: payload.derivedValues, fixedValues: payload.fixedValues, transformations: payload.transformations });
        spec.specJson = payload;
        spec.lastMatchedAt = new Date();
        try { await DI.em.persist(spec).flush(); } catch (error) { logger.warn({ error, parserSpecKey: spec.portfolioImportParserSpecKey }, 'Portfolio import parser spec match feedback failed'); }
        return spec;
      } catch (error) {
        try { await this.recordSpecFailure(spec); } catch (feedbackError) { logger.warn({ error: feedbackError, parserSpecKey: spec.portfolioImportParserSpecKey }, 'Portfolio import parser spec failure feedback failed'); }
        logger.warn({ error, parserSpecKey: spec.portfolioImportParserSpecKey }, 'Portfolio import parser spec candidate validation failed');
      }
    }
    return undefined;
  }

  /**
   * Runs in a transaction of its own (a savepoint when the caller already has one), because the
   * advisory lock below is transaction-scoped: taken on the transaction's connection, it is held
   * until commit, so concurrent promotions of one broker layout queue instead of racing to insert.
   */
  async promoteTenantSpec(input: PromoteTenantSpecInput, em: EntityManager = DI.em): Promise<PromoteTenantSpecResult> {
    return em.transactional((txEm) => this.promoteTenantSpecInTransaction(input, txEm));
  }

  async recordSpecFailure(spec: PortfolioImportParserSpec, options: { kind: 'runtime' | 'structural' } = { kind: 'structural' }): Promise<void> {
    spec.failureCount += 1;
    spec.lastFailedAt = new Date();
    if (spec.failureCount >= 3 && (spec.scope !== PortfolioImportParserSpecScope.GLOBAL || options.kind === 'structural')) spec.status = PortfolioImportParserSpecStatus.QUARANTINED;
    await DI.em.persist(spec).flush();
  }

  async recordSpecFailureByKey(input: { contentHash: string; parserSpecKey: number }, em: EntityManager = DI.em): Promise<void> {
    const spec = await em.findOne(PortfolioImportParserSpec, { contentHash: input.contentHash, deletedAt: undefined, portfolioImportParserSpecKey: input.parserSpecKey });
    if (!spec) return;
    spec.failureCount += 1;
    spec.lastFailedAt = new Date();
    if (spec.failureCount >= 3 && spec.scope !== PortfolioImportParserSpecScope.GLOBAL) spec.status = PortfolioImportParserSpecStatus.QUARANTINED;
    await em.persist(spec).flush();
  }

  async recordSpecSuccess(spec: PortfolioImportParserSpec): Promise<void> {
    spec.successCount += 1;
    spec.lastSucceededAt = new Date();
    await DI.em.persist(spec).flush();
  }

  async recordSpecSuccessByKey(input: { contentHash: string; parserSpecKey: number }, em: EntityManager = DI.em): Promise<void> {
    const spec = await em.findOne(PortfolioImportParserSpec, { contentHash: input.contentHash, deletedAt: undefined, portfolioImportParserSpecKey: input.parserSpecKey });
    if (!spec) return;
    spec.successCount += 1;
    spec.lastSucceededAt = new Date();
    await em.persist(spec).flush();
  }

  async saveConfirmedSpec(input: { appuser: Appuser; broker?: { financialBrokerKey: number }; columnMapping: PortfolioColumnMapping; derivedValues?: PortfolioImportDerivedValues; fixedValues?: PortfolioImportFixedValues; headers: string[]; layout: PortfolioCsvLayout; suggestionSource: 'llm' | 'spec' | 'user'; tenant: { tenantKey: number }; transformations: PortfolioColumnMappingTransformations }): Promise<PortfolioImportParserSpec> {
    const fingerprint = buildPortfolioCsvShapeFingerprint(input);
    const payload = buildPortfolioImportParserSpecPayload(input);
    const contentHash = hashPortfolioImportParserSpecPayload(payload);
    const broker = input.broker ? ({ financialBrokerKey: input.broker.financialBrokerKey } as FinancialBroker) : undefined;
    return DI.em.transactional(async (em) => {
      await lockUntilCommit(em, `portfolio-parser-candidate:${input.tenant.tenantKey}:${input.broker?.financialBrokerKey ?? 0}:${fingerprint.shapeHash}`);
      const existing = await em.findOne(PortfolioImportParserSpec, { deletedAt: undefined, engineVersion: PORTFOLIO_IMPORT_SPEC_ENGINE_VERSION, financialBrokerKey: broker ?? null, schemaVersion: PORTFOLIO_IMPORT_SPEC_SCHEMA_VERSION, scope: PortfolioImportParserSpecScope.TENANT, shapeHash: fingerprint.shapeHash, status: PortfolioImportParserSpecStatus.ACTIVE, tenantKey: { tenantKey: input.tenant.tenantKey } });
      if (existing?.contentHash === contentHash) return existing;
      if (existing) {
        existing.status = PortfolioImportParserSpecStatus.DEPRECATED;
        await em.persist(existing).flush();
      }
      const spec = new PortfolioImportParserSpec();
      Object.assign(spec, {
      appuserKey: undefined,
      contentHash,
      engineVersion: PORTFOLIO_IMPORT_SPEC_ENGINE_VERSION,
      failureCount: 0,
      financialBrokerKey: broker,
      fingerprintAlgorithm: 'portfolio-csv-shape-v1',
      headerOrderHash: fingerprint.headerOrderHash,
      headerSetHash: fingerprint.headerSetHash,
      normalizedHeadersJson: fingerprint.normalizedHeaders,
      schemaVersion: PORTFOLIO_IMPORT_SPEC_SCHEMA_VERSION,
      scope: PortfolioImportParserSpecScope.TENANT,
      shapeHash: fingerprint.shapeHash,
      source: input.suggestionSource === 'llm' ? PortfolioImportParserSpecSource.LLM_CONFIRMED : PortfolioImportParserSpecSource.USER_CONFIRMED,
      specJson: payload,
      specVersion: (existing?.specVersion ?? 0) + 1,
      status: PortfolioImportParserSpecStatus.ACTIVE,
      successCount: 0,
      supersedesSpecKey: existing,
      tenantKey: { tenantKey: input.tenant.tenantKey } as Tenant,
      });
      await em.persist(spec).flush();
      return spec;
    });
  }

  private async promoteTenantSpecInTransaction(input: PromoteTenantSpecInput, em: EntityManager): Promise<PromoteTenantSpecResult> {
    const candidate = await em.findOne(PortfolioImportParserSpec, { deletedAt: undefined, portfolioImportParserSpecKey: input.parserSpecKey, scope: PortfolioImportParserSpecScope.TENANT, status: PortfolioImportParserSpecStatus.ACTIVE }, { populate: ['financialBrokerKey', 'tenantKey'] });
    if (candidate?.financialBrokerKey?.financialBrokerKey !== input.expectedBrokerKey || candidate.tenantKey?.tenantKey !== input.expectedTenantKey || candidate.contentHash !== input.expectedContentHash) return { status: 'ineligible' };
    const payload = parsePortfolioImportParserSpecPayload(candidate.specJson);
    if (!isSafeForGlobalPromotion(payload)) return { status: 'ineligible' };
    const contentHash = hashPortfolioImportParserSpecPayload(payload);
    if (contentHash !== input.expectedContentHash) return { status: 'ineligible' };
    await lockUntilCommit(em, `portfolio-parser:${candidate.financialBrokerKey.financialBrokerKey}:${candidate.shapeHash}`);
    const existing = await em.findOne(PortfolioImportParserSpec, { deletedAt: undefined, engineVersion: PORTFOLIO_IMPORT_SPEC_ENGINE_VERSION, financialBrokerKey: candidate.financialBrokerKey, schemaVersion: PORTFOLIO_IMPORT_SPEC_SCHEMA_VERSION, scope: PortfolioImportParserSpecScope.GLOBAL, shapeHash: candidate.shapeHash, status: PortfolioImportParserSpecStatus.ACTIVE });
    if (existing) {
      if (existing.contentHash !== contentHash) {
        logger.warn({ brokerId: candidate.financialBrokerKey.financialBrokerKey, candidateParserSpecKey: candidate.portfolioImportParserSpecKey, globalParserSpecKey: existing.portfolioImportParserSpecKey, shapeHash: candidate.shapeHash }, 'Portfolio import parser spec global promotion conflict');
        return { globalParserSpecKey: existing.portfolioImportParserSpecKey, status: 'conflict' };
      }
      if (candidate.promotedAt) return { globalParserSpecKey: existing.portfolioImportParserSpecKey, status: 'promoted' };
      existing.successCount += 1;
      existing.lastSucceededAt = new Date();
      candidate.promotedAt ??= new Date();
      await em.persist([existing, candidate]).flush();
      return { globalParserSpecKey: existing.portfolioImportParserSpecKey, status: 'promoted' };
    }
    const global = Object.assign(new PortfolioImportParserSpec(), {
      contentHash,
      engineVersion: PORTFOLIO_IMPORT_SPEC_ENGINE_VERSION,
      failureCount: 0,
      financialBrokerKey: candidate.financialBrokerKey,
      fingerprintAlgorithm: candidate.fingerprintAlgorithm,
      headerOrderHash: candidate.headerOrderHash,
      headerSetHash: candidate.headerSetHash,
      normalizedHeadersJson: uniqueMappedHeaders(payload),
      promotedAt: new Date(),
      schemaVersion: PORTFOLIO_IMPORT_SPEC_SCHEMA_VERSION,
      scope: PortfolioImportParserSpecScope.GLOBAL,
      shapeHash: candidate.shapeHash,
      source: candidate.source,
      specJson: payload,
      specVersion: candidate.specVersion,
      status: PortfolioImportParserSpecStatus.ACTIVE,
      successCount: 1,
    });
    candidate.promotedAt ??= new Date();
    await em.persist([global, candidate]).flush();
    return { globalParserSpecKey: global.portfolioImportParserSpecKey, status: 'promoted' };
  }
}

export function buildPortfolioCsvShapeFingerprint(input: { headers: string[]; layout: PortfolioCsvLayout }) {
  const normalizedHeaders = input.headers.map((header) => normalizeCsvHeader(header));
  const ordered = normalizedHeaders.join('\u001f');
  const sorted = [...normalizedHeaders].sort().join('\u001f');
  const headerOrderHash = createHash('sha256').update(ordered).digest('hex');
  const headerSetHash = createHash('sha256').update(sorted).digest('hex');
  const footerMatchers = [...(input.layout.footerMatchers ?? [])].map((matcher) => matcher.trim()).filter(Boolean).sort().join('\u001f');
  const shapeHash = createHash('sha256').update([PORTFOLIO_IMPORT_SPEC_ENGINE_VERSION, headerSetHash, String(input.layout.headerRowIndex), String(input.layout.dataStartRowIndex), String(input.layout.footerRowCount ?? 0), footerMatchers].join('|')).digest('hex');
  return { headerOrderHash, headerSetHash, normalizedHeaders, shapeHash };
}

export function buildPortfolioImportParserSpecPayload(input: { columnMapping: PortfolioColumnMapping; derivedValues?: PortfolioImportDerivedValues; fixedValues?: PortfolioImportFixedValues; headers: string[]; layout: PortfolioCsvLayout; transformations: PortfolioColumnMappingTransformations }) {
  const fixedValues = input.fixedValues ?? {};
  const currencyOrigin = fixedValues.currency && hasEmbeddedMappedCurrency(input.columnMapping, input.headers, fixedValues.currency) ? 'embedded_header' as const : undefined;
  return portfolioImportParserSpecPayloadSchema.parse({ columns: buildSpecColumnsFromMapping({ columnMapping: input.columnMapping, headers: input.headers }), derivedValues: input.derivedValues ?? {}, fixedValueOrigins: { ...(currencyOrigin ? { currency: currencyOrigin } : {}) }, fixedValues, layout: input.layout, parser: 'column-mapping-v2', transformations: input.transformations });
}

export function buildSpecColumnsFromMapping(input: { columnMapping: PortfolioColumnMapping; headers?: string[] }) {
  const columns: Record<string, PortfolioSpecColumnReference> = {};
  for (const [field, value] of Object.entries(input.columnMapping)) {
    if (!value) continue;
    const normalizedHeader = normalizeCsvHeader(value);
    const occurrence = input.headers ? resolveHeaderOccurrence(input.headers, value) : undefined;
    columns[field] = { normalizedHeader, ...(occurrence === undefined ? {} : { occurrence }) };
  }
  return columns;
}

export function hashPortfolioImportParserSpecPayload(payload: PortfolioImportParserSpecPayload) {
  return createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');
}

export function parsePortfolioImportParserSpecPayload(value: unknown) { return portfolioImportParserSpecPayloadSchema.parse(value); }

export function resolveSpecColumnMapping(input: { actualHeaders: string[]; columns: Record<string, PortfolioSpecColumnReference> }) {
  const normalizedToActual = new Map<string, string[]>();
  for (const header of input.actualHeaders) {
    const normalizedHeader = normalizeCsvHeader(header);
    const matches = normalizedToActual.get(normalizedHeader) ?? [];
    matches.push(header);
    normalizedToActual.set(normalizedHeader, matches);
  }
  const resolved: Record<string, string> = {};
  for (const [field, column] of Object.entries(input.columns)) {
    const actual = (normalizedToActual.get(column.normalizedHeader) ?? [])[column.occurrence ?? 0];
    if (actual) resolved[field] = actual;
  }
  return resolved;
}

function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (!value || typeof value !== 'object') return [];
  return Object.values(value as Record<string, unknown>).flatMap(allStrings);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
}

function hasEmbeddedMappedCurrency(columnMapping: PortfolioColumnMapping, headers: string[], currency: string) {
  return ['feeAmount', 'totalAmount', 'unitPrice'].some((field) => {
    const header = columnMapping[field as keyof PortfolioColumnMapping];
    return typeof header === 'string' && headers.includes(header) && mappedHeaderEmbedsCurrency(header, currency);
  });
}

function isSafeForGlobalPromotion(payload: PortfolioImportParserSpecPayload) {
  if ((payload.layout.footerMatchers ?? []).length > 0) return false;
  if (payload.fixedValues.transactionType) return false;
  const currency = payload.fixedValues.currency;
  if (currency && payload.fixedValueOrigins.currency !== 'embedded_header') return false;
  if (currency && !Object.values(payload.columns).some(({ normalizedHeader }) => mappedHeaderEmbedsCurrency(normalizedHeader, currency))) return false;
  return allStrings(payload).every(isSafeGlobalString);
}

function isSafeGlobalString(value: string) { return !value.includes('@') && !/\d{8,}/.test(value) && value.length <= 80 && !/[a-z0-9]{40,}/i.test(value); }

/**
 * Take a transaction-scoped advisory lock on `em`'s open transaction, so it is held until that
 * transaction commits. Without the transaction context the query goes to another pooled
 * connection in autocommit and the lock is released as soon as it is granted.
 */
async function lockUntilCommit(em: EntityManager, key: string) {
  await em.getConnection().execute('select pg_advisory_xact_lock(hashtext(?))', [key], 'run', em.getTransactionContext());
}

function mappedHeaderEmbedsCurrency(header: string, currency: string) { return new RegExp(`(?:^|[^A-Z])${currency}(?:$|[^A-Z])`, 'i').test(header); }

function resolveHeaderOccurrence(headers: string[], rawHeader: string) {
  const normalizedHeader = normalizeCsvHeader(rawHeader);
  const actualIndex = headers.findIndex((header) => header === rawHeader);
  if (actualIndex >= 0) return headers.slice(0, actualIndex).filter((header) => normalizeCsvHeader(header) === normalizedHeader).length;
  return headers.filter((header) => normalizeCsvHeader(header) === normalizedHeader).length > 0 ? 0 : undefined;
}

function uniqueMappedHeaders(payload: PortfolioImportParserSpecPayload) { return [...new Set(Object.values(payload.columns).map(({ normalizedHeader }) => normalizedHeader))].filter(isSafeGlobalString); }

export default new PortfolioImportParserSpecService();

import { randomUUID } from 'node:crypto';

import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { sqlQuery } from '@app/database/sql';
import { enqueuePortfolioSnapshotManualJob } from '@app/jobs/portfolio-snapshot.queue';
import { Appuser } from '@entity/Appuser';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialAssetPriceOverride } from '@entity/FinancialAssetPriceOverride';
import { Tenant } from '@entity/Tenant';
import type { Enqueue } from '@service/queue/enqueue';
import { getRef } from '@utils/em-helpers';
import { BadRequestError, ConflictError, NotFoundError } from '@utils/errors';
import logger from '@utils/logger';

import assetPriceService, { priceDay } from './asset-price.service';

/**
 * A household's manual prices for a security (`FinancialAssetPriceOverride`): read the price
 * history with them, read the price on a day, set one, remove one.
 *
 * Every read and write names the household explicitly, on top of the request's tenant filter, so
 * another household's override is indistinguishable from none. Any member may write. A write
 * queues a snapshot rebuild, from the override's day, of every household portfolio that trades
 * the asset; current holding values read the new price at once.
 */

export interface AssetPriceHistory {
  /** The asset's currency, the one every price is in. Null when the catalogue has none. */
  currency: null | string;
  prices: AssetPricePoint[];
}

export interface AssetPriceOnDay {
  currency: null | string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** The household's override set for exactly this day, if any. */
  override: null | { note: null | string; price: number };
  /** The price in effect on the day: the latest on or before it, an override winning its own day. */
  price: null | number;
  source: null | PriceSource;
}

export interface AssetPricePoint {
  /** `YYYY-MM-DD`. */
  date: string;
  price: number;
  source: PriceSource;
}

export type PriceSource = 'manual' | 'market';

interface Actor {
  appuserKey: number;
  tenantKey: number;
}

interface Deps {
  enqueue?: Enqueue;
}

/** `YYYY-MM-DD` → that day at 00:00 UTC. */
const startOfDay = (day: string) => new Date(`${day}T00:00:00.000Z`);
const endOfDay = (day: string) => new Date(`${day}T23:59:59.999Z`);

export async function getAssetPriceHistory(em: EntityManager, tenantKey: number, financialAssetKey: number, range: { from?: string; to?: string } = {}): Promise<AssetPriceHistory> {
  const asset = await findAsset(em, financialAssetKey);
  if (range.from && range.to && range.from > range.to) throw new BadRequestError('from must be on or before to');
  const db = sqlQuery(em);
  const [marketRows, overrideRows] = await Promise.all([
    db.selectFrom('financial_asset_price')
      .select(['date', 'price'])
      .where('financial_asset_key', '=', financialAssetKey)
      .$if(range.from !== undefined, (query) => query.where('date', '>=', startOfDay(range.from ?? '')))
      .$if(range.to !== undefined, (query) => query.where('date', '<=', endOfDay(range.to ?? '')))
      .orderBy('date', 'asc')
      .execute(),
    // Raw SQL bypasses the tenant filter: the tenant and soft-delete predicates are explicit.
    db.selectFrom('financial_asset_price_override')
      .select(['date', 'price'])
      .where('financial_asset_key', '=', financialAssetKey)
      .where('tenant_key', '=', tenantKey)
      .where('deleted_at', 'is', null)
      .$if(range.from !== undefined, (query) => query.where('date', '>=', startOfDay(range.from ?? '')))
      .$if(range.to !== undefined, (query) => query.where('date', '<=', endOfDay(range.to ?? '')))
      .execute(),
  ]);
  const byDay = new Map<string, AssetPricePoint>();
  for (const row of marketRows as { date: Date | string; price: number }[]) {
    const date = priceDay(row.date);
    byDay.set(date, { date, price: row.price, source: 'market' });
  }
  for (const row of overrideRows as { date: Date | string; price: number }[]) {
    const date = priceDay(row.date);
    byDay.set(date, { date, price: row.price, source: 'manual' });
  }
  return { currency: asset.currencyKey?.code ?? null, prices: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}

export async function getAssetPriceOnDay(em: EntityManager, tenantKey: number, financialAssetKey: number, day: string): Promise<AssetPriceOnDay> {
  const asset = await findAsset(em, financialAssetKey);
  const [override, effective] = await Promise.all([
    findLive(em, tenantKey, financialAssetKey, day),
    assetPriceService.getPricesAsOf([financialAssetKey], endOfDay(day), tenantKey),
  ]);
  const price = effective.get(financialAssetKey);
  return {
    currency: asset.currencyKey?.code ?? null,
    date: day,
    override: override ? { note: override.note ?? null, price: override.price } : null,
    price: price?.price ?? null,
    source: price?.source ?? null,
  };
}

/** Set (create or replace) the household's price for the asset on the day. */
export async function setAssetPriceOverride(
  em: EntityManager,
  actor: Actor,
  financialAssetKey: number,
  day: string,
  input: { currency: string; note?: null | string; price: number },
  deps: Deps = {},
): Promise<AssetPriceOnDay> {
  const asset = await findAsset(em, financialAssetKey);
  if (!asset.currencyKey) throw new BadRequestError('This security has no currency to price it in');
  if (input.currency !== asset.currencyKey.code.toUpperCase()) throw new BadRequestError(`The price must be in the security's currency, ${asset.currencyKey.code}`);
  const currency = asset.currencyKey;
  try {
    await em.transactional(async (tx) => {
      const existing = await findLive(tx, actor.tenantKey, financialAssetKey, day);
      const override = existing ?? tx.create(FinancialAssetPriceOverride, {
        currencyKey: currency,
        date: startOfDay(day),
        financialAssetKey: asset,
        price: input.price,
        tenantKey: getRef(tx, Tenant, actor.tenantKey),
      }, { partial: true });
      override.createdByAppuserKey = getRef(tx, Appuser, actor.appuserKey);
      override.currencyKey = currency;
      override.note = input.note?.trim() ? input.note.trim() : null;
      override.price = input.price;
      await tx.flush();
    });
  } catch (error) {
    // Two members saving the same day at once: the partial unique index has the final word.
    if (error instanceof UniqueConstraintViolationException) throw new ConflictError('A price for this security and day was just set; reload and try again');
    throw error;
  }
  await queueSnapshotRebuild(em, actor, financialAssetKey, day, deps);
  return getAssetPriceOnDay(em, actor.tenantKey, financialAssetKey, day);
}

/** Remove the household's price for the asset on the day; the market price applies again. */
export async function deleteAssetPriceOverride(em: EntityManager, actor: Actor, financialAssetKey: number, day: string, deps: Deps = {}): Promise<void> {
  await findAsset(em, financialAssetKey);
  const override = await findLive(em, actor.tenantKey, financialAssetKey, day);
  if (!override) throw new NotFoundError('Price override not found');
  override.deletedAt = new Date();
  await em.flush();
  await queueSnapshotRebuild(em, actor, financialAssetKey, day, deps);
}

async function findAsset(em: EntityManager, financialAssetKey: number): Promise<FinancialAsset> {
  const asset = await em.findOne(FinancialAsset, { financialAssetKey }, { populate: ['currencyKey'] });
  if (!asset) throw new NotFoundError('Financial asset not found');
  return asset;
}

function findLive(em: EntityManager, tenantKey: number, financialAssetKey: number, day: string) {
  return em.findOne(FinancialAssetPriceOverride, {
    date: startOfDay(day),
    deletedAt: null,
    financialAssetKey: getRef(em, FinancialAsset, financialAssetKey),
    tenantKey: getRef(em, Tenant, tenantKey),
  });
}

/**
 * Queue a snapshot rebuild from `day` for each household portfolio that trades the asset. The
 * change is already committed and current values already use it; a failure to queue is logged,
 * and the nightly snapshot and the next rebuild catch the history up.
 */
async function queueSnapshotRebuild(em: EntityManager, actor: Actor, financialAssetKey: number, day: string, deps: Deps): Promise<void> {
  const context = { day, financialAssetKey, tenantKey: actor.tenantKey };
  if (!deps.enqueue) {
    logger.error(context, 'No queue to rebuild portfolio snapshots after a price override change');
    return;
  }
  try {
    // Raw SQL bypasses the tenant filter: the tenant and soft-delete predicates are explicit.
    const portfolios = await sqlQuery(em)
      .selectFrom('portfolio as p')
      .innerJoin('financial_transaction as ft', 'ft.portfolio_key', 'p.portfolio_key')
      .select('p.portfolio_key')
      .distinct()
      .where('p.tenant_key', '=', actor.tenantKey)
      .where('p.deleted_at', 'is', null)
      .where('ft.deleted_at', 'is', null)
      .where('ft.financial_asset_key', '=', financialAssetKey)
      .execute();
    for (const { portfolio_key: portfolioKey } of portfolios as { portfolio_key: number }[]) {
      const correlationId = `portfolio.snapshot:price-override:${randomUUID()}`;
      await enqueuePortfolioSnapshotManualJob({ correlationId, portfolioId: portfolioKey, startDate: day }, { enqueue: deps.enqueue });
    }
  } catch (error) {
    logger.error({ ...context, error }, 'Could not queue a portfolio snapshot rebuild after a price override change');
  }
}

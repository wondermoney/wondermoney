import { randomUUID } from 'node:crypto';

import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { enqueueFxReconvertJob } from '@app/jobs/fx-reconvert.queue';
import { Appuser } from '@entity/Appuser';
import { Currency } from '@entity/Currency';
import { ExchangeRateOverride } from '@entity/ExchangeRateOverride';
import { ExchangeRateOverrideAuditAction, ExchangeRateOverrideAuditLog } from '@entity/ExchangeRateOverrideAuditLog';
import { Tenant } from '@entity/Tenant';
import type { FxOverridePair } from '@service/currency/fx-reconvert.service';
import type { Enqueue } from '@service/queue/enqueue';
import { getRef } from '@utils/em-helpers';
import { BadRequestError, ConflictError, ERROR_CODE, NotFoundError } from '@utils/errors';
import logger from '@utils/logger';

/**
 * A household's own exchange rates (`ExchangeRateOverride`): list, add, change, delete.
 *
 * Every read and write names the household explicitly, on top of the request's tenant filter, so
 * an override of another household is indistinguishable from one that does not exist (404). Any
 * member may write. Each change is audited with the member, in the same database transaction, and
 * then queues `fx.reconvert` for the household and pair, which converts the stored amounts again.
 * The conversions computed on read (reports, net worth) use the new rate at once.
 */

export interface ExchangeRateOverrideDto {
  /** `YYYY-MM-DD`. */
  date: string;
  fromCurrency: string;
  id: number;
  rate: number;
  toCurrency: string;
  updatedAt: string;
}

interface Actor {
  appuserKey: number;
  tenantKey: number;
}

interface Deps {
  enqueue?: Enqueue;
}

const toDto = (override: ExchangeRateOverride): ExchangeRateOverrideDto => ({
  date: dayOf(override.date),
  fromCurrency: override.fromCurrency.code,
  id: override.exchangeRateOverrideKey,
  rate: override.rate,
  toCurrency: override.toCurrency.code,
  updatedAt: override.updatedAt.toISOString(),
});

/** Newest day first, then by pair. */
const compareOverrides = (a: ExchangeRateOverrideDto, b: ExchangeRateOverrideDto) => b.date.localeCompare(a.date) || a.fromCurrency.localeCompare(b.fromCurrency) || a.toCurrency.localeCompare(b.toCurrency) || a.id - b.id;

export async function createExchangeRateOverride(em: EntityManager, actor: Actor, input: { date: Date; fromCurrency: string; rate: number; toCurrency: string }, deps: Deps = {}): Promise<ExchangeRateOverrideDto> {
  const [fromCurrency, toCurrency] = await Promise.all([findCurrency(em, input.fromCurrency), findCurrency(em, input.toCurrency)]);
  const override = await writeOrConflict(em, async (tx) => {
    const created = tx.create(ExchangeRateOverride, {
      createdByAppuserKey: getRef(tx, Appuser, actor.appuserKey),
      date: input.date,
      fromCurrency,
      rate: input.rate,
      tenantKey: getRef(tx, Tenant, actor.tenantKey),
      toCurrency,
    }, { partial: true });
    await tx.flush();
    audit(tx, actor, created, ExchangeRateOverrideAuditAction.CREATED, { date: { from: null, to: dayOf(created.date) }, rate: { from: null, to: input.rate } });
    return created;
  });
  await queueReconversion(actor, override, deps);
  return toDto(override);
}

export async function deleteExchangeRateOverride(em: EntityManager, actor: Actor, overrideKey: number, deps: Deps = {}): Promise<void> {
  const override = await em.transactional(async (tx) => {
    const found = await findLive(tx, actor.tenantKey, overrideKey);
    found.deletedAt = new Date();
    audit(tx, actor, found, ExchangeRateOverrideAuditAction.DELETED, { date: { from: dayOf(found.date), to: null }, rate: { from: found.rate, to: null } });
    await tx.flush();
    return found;
  });
  await queueReconversion(actor, override, deps);
}

export async function listExchangeRateOverrides(em: EntityManager, tenantKey: number): Promise<ExchangeRateOverrideDto[]> {
  const overrides = await em.find(ExchangeRateOverride, { deletedAt: null, tenantKey: getRef(em, Tenant, tenantKey) }, { populate: ['fromCurrency', 'toCurrency'] });
  return overrides.map(toDto).sort(compareOverrides);
}

export async function updateExchangeRateOverride(em: EntityManager, actor: Actor, overrideKey: number, input: { date?: Date; rate?: number }, deps: Deps = {}): Promise<ExchangeRateOverrideDto> {
  const override = await writeOrConflict(em, async (tx) => {
    const found = await findLive(tx, actor.tenantKey, overrideKey);
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (input.date !== undefined && input.date.getTime() !== new Date(found.date).getTime()) {
      changes['date'] = { from: dayOf(found.date), to: dayOf(input.date) };
      found.date = input.date;
    }
    if (input.rate !== undefined && input.rate !== found.rate) {
      changes['rate'] = { from: found.rate, to: input.rate };
      found.rate = input.rate;
    }
    if (Object.keys(changes).length > 0) audit(tx, actor, found, ExchangeRateOverrideAuditAction.UPDATED, changes);
    await tx.flush();
    return { changed: Object.keys(changes).length > 0, found };
  });
  if (override.changed) await queueReconversion(actor, override.found, deps);
  return toDto(override.found);
}

function audit(em: EntityManager, actor: Actor, override: ExchangeRateOverride, action: ExchangeRateOverrideAuditAction, changes: Record<string, { from: unknown; to: unknown }>): void {
  em.create(ExchangeRateOverrideAuditLog, {
    action,
    actorAppuserKey: getRef(em, Appuser, actor.appuserKey),
    changes,
    exchangeRateOverrideKey: override,
    tenantKey: getRef(em, Tenant, actor.tenantKey),
  }, { partial: true });
}

function dayOf(date: Date): string {
  return new Date(date).toISOString().slice(0, 10);
}

async function findCurrency(em: EntityManager, code: string): Promise<Currency> {
  const currency = await em.findOne(Currency, { code, isActive: true });
  if (!currency) throw new BadRequestError(`Unknown currency: ${code}`, ERROR_CODE.UNKNOWN_CURRENCY);
  return currency;
}

async function findLive(em: EntityManager, tenantKey: number, overrideKey: number): Promise<ExchangeRateOverride> {
  const override = await em.findOne(ExchangeRateOverride, { deletedAt: null, exchangeRateOverrideKey: overrideKey, tenantKey: getRef(em, Tenant, tenantKey) }, { populate: ['fromCurrency', 'toCurrency'] });
  if (!override) throw new NotFoundError('Exchange rate not found');
  return override;
}

/** One live override per household, pair and day; the partial unique index is the final word. */
async function writeOrConflict<T>(em: EntityManager, work: (tx: EntityManager) => Promise<T>): Promise<T> {
  try {
    return await em.transactional(work);
  } catch (error) {
    if (error instanceof UniqueConstraintViolationException) throw new ConflictError('An exchange rate for this pair and day already exists', ERROR_CODE.EXCHANGE_RATE_OVERRIDE_EXISTS);
    throw error;
  }
}

/**
 * Queue the re-conversion of the household's amounts in the pair. The change is already committed
 * and the computed-on-read figures already use it; a failure to queue is logged, and the stored
 * amounts follow on the pair's next change.
 */
async function queueReconversion(actor: Actor, override: ExchangeRateOverride, deps: Deps): Promise<void> {
  const pair: FxOverridePair = { fromCurrency: override.fromCurrency.code, tenantKey: actor.tenantKey, toCurrency: override.toCurrency.code };
  if (!deps.enqueue) {
    logger.error({ pair }, 'No queue to re-convert amounts after an exchange-rate override change');
    return;
  }
  try {
    await enqueueFxReconvertJob({ correlationId: `fx.reconvert:override:${randomUUID()}`, override: pair }, { enqueue: deps.enqueue });
  } catch (error) {
    logger.error({ error, pair }, 'Could not queue fx.reconvert after an exchange-rate override change');
  }
}

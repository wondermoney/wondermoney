import type { EntityManager, FilterQuery } from '@mikro-orm/core';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType, TransactionAuditLog } from '@entity/TransactionAuditLog';
import { TransactionType } from '@entity/TransactionType';
import { getRef } from '@utils/em-helpers';
import { roundMoney, toNumber } from '@utils/money';

import { TransactionAuditService } from './transaction-audit.service';

/**
 * Income unless matched.
 *
 * Bank sync stores an incoming payment as DEPOSIT (income) and an outgoing one as PAYMENT. Only a
 * matched pair, money leaving one account of a household and the same money arriving on another, is
 * typed TRANSFER_OUT / TRANSFER_IN, which every report leaves out by default. The two rows of a pair
 * point at each other through `transferCounterpartKey`.
 *
 * ## The matching rule
 *
 * An outgoing row O and an incoming row I are a pair when:
 * - they are in the same tenant (household) and on two different accounts;
 * - both are BOOKED, not soft-deleted, not hidden, dated, and not already in a pair;
 * - they have the same settlement currency and the same absolute settlement amount, to the cent;
 * - their dates are at most {@link TRANSFER_MATCH_WINDOW_DAYS} calendar days apart;
 * - each is the other's unique closest candidate. A tie at the closest distance is ambiguous and is
 *   left unpaired. Pairs are accepted round by round, so once a row is taken a tie it was part of may
 *   resolve. The result depends only on the rows, never on the order they were read.
 *
 * ## Which rows take part
 *
 * - **Re-typeable**: a bank-synced row (it has a provider id) still carrying the type the sync gives
 *   its direction, DEPOSIT for money in and PAYMENT for money out, whose type no user changed. Pairing
 *   re-types it.
 * - **Anchor**: a row a person typed as a transfer, unpaired: a manual row typed TRANSFER_IN /
 *   TRANSFER_OUT, or a synced row a user re-typed so. Pairing links it but never changes its type.
 * - A pair needs at least one re-typeable row. Two anchors are already both transfers.
 * - Never: a manual DEPOSIT or PAYMENT (the person said what it is), CARD_PAYMENT and every other
 *   type, and any row a user re-typed to something other than a transfer.
 *
 * A type is user-set when the audit log has a USER entry that changed `transactionTypeKey`. No edit
 * path changes a type today (a manual row's type is the one it was created with, which the anchor
 * rule respects); the check keeps a future edit from being undone here. A row created through
 * `createTransaction` records its type that way, so a generic CSV row, which stores the file's id
 * like a synced row, keeps the type its file gave it.
 *
 * ## Upkeep, before matching
 *
 * - A stored pair that no longer satisfies the rule (one side expired, deleted, re-amounted, or no
 *   longer pointing back) is dissolved. A synced side gets its direction's type back, unless a user
 *   set it; a manual side keeps its type.
 * - An unpaired synced row typed TRANSFER_IN / TRANSFER_OUT is a leftover of an older sync that typed
 *   every credit TRANSFER_IN. It gets its direction's type, unless a user set it, and may then
 *   pair like any other row.
 *
 * Idempotent: a second run over the same rows finds nothing to change and writes nothing. Each change
 * is audited as SYSTEM_EDIT. With `apply: false` nothing is written and no entity is modified, so it
 * is safe inside a transaction that flushes on commit. A row with no owner cannot be audited, so it
 * is left out entirely.
 */

/**
 * How many calendar days apart the two halves of a transfer may be booked. A SEPA credit transfer
 * reaches the payee's bank by the end of the next business day (PSD2, art. 83) and an instant one in
 * seconds, so most pairs book the same day or the next. A transfer sent on a Friday, or before a
 * public holiday, can book on the receiving side on the Monday or Tuesday: three days covers a
 * weekend. A wider window mostly adds false pairs between unrelated round amounts (a 50 out and a 50
 * in a week later), which this rule would then hide from income and spending.
 */
const TRANSFER_MATCH_WINDOW_DAYS = 3;

const DEPOSIT = 'DEPOSIT';
const PAYMENT = 'PAYMENT';
const TRANSFER_IN = 'TRANSFER_IN';
const TRANSFER_OUT = 'TRANSFER_OUT';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface TransferPlan {
  changes: TransferRowChange[];
  pairsDissolved: number;
  pairsMatched: number;
}

export interface TransferReconciliationInput {
  actorType: TransactionAuditActorType;
  /** False: plan and report only. */
  apply: boolean;
  /** Only rows dated from here on, less the matching window. Omitted: the tenant's whole history. */
  from?: Date;
  /** Audit `source`. */
  source: string;
  tenantKey: number;
}

export interface TransferReconciliationResult {
  pairsDissolved: number;
  pairsMatched: number;
  /** Rows that end as DEPOSIT after being typed TRANSFER_IN. */
  retypedAsIncome: number;
  rowsChanged: number;
}

/** What the planner knows about a row. Plain data: planning never touches an entity. */
export interface TransferRow {
  accountKey: null | number;
  booked: boolean;
  /** Settlement amount in cents, signed. */
  cents: number;
  counterpartKey: null | number;
  currencyKey: null | number;
  /** Calendar day number (UTC), or null when undated. */
  day: null | number;
  deleted: boolean;
  hidden: boolean;
  synced: boolean;
  transactionKey: number;
  typeName: null | string;
  userTyped: boolean;
}

export interface TransferRowChange {
  counterpartKey: { from: null | number; to: null | number };
  transactionKey: number;
  typeName: { from: null | string; to: null | string };
}

export async function reconcileTransfers(em: EntityManager, input: TransferReconciliationInput): Promise<TransferReconciliationResult> {
  // A row with no owner cannot be audited, so it is never changed (and never pairs).
  const entities = (await loadRows(em, input)).filter((entity) => entity.appuserKey != null);
  const userTyped = await loadUserTypedKeys(em, input.tenantKey);
  const plan = planTransfers(entities.map((entity) => toTransferRow(entity, userTyped)));
  const result: TransferReconciliationResult = {
    pairsDissolved: plan.pairsDissolved,
    pairsMatched: plan.pairsMatched,
    retypedAsIncome: plan.changes.filter((change) => change.typeName.from === TRANSFER_IN && change.typeName.to === DEPOSIT).length,
    rowsChanged: plan.changes.length,
  };
  if (!input.apply || plan.changes.length === 0) return result;

  const byKey = new Map(entities.map((entity) => [entity.transactionKey, entity]));
  const types = await loadTypes(em);
  for (const change of plan.changes) {
    if (change.typeName.to !== null && change.typeName.to !== change.typeName.from && !types.has(change.typeName.to)) throw new Error(`Transaction type ${change.typeName.to} not found`);
  }
  // The counterpart column is unique, so every link that changes is cleared, and flushed, before any
  // new one is written: a row moving from one pair to another is released first.
  const relinked = plan.changes.filter((change) => change.counterpartKey.from !== null && change.counterpartKey.from !== change.counterpartKey.to);
  if (relinked.length > 0) {
    for (const change of relinked) {
      const entity = byKey.get(change.transactionKey);
      if (entity) entity.transferCounterpartKey = undefined;
    }
    await em.flush();
  }
  for (const change of plan.changes) {
    const entity = byKey.get(change.transactionKey);
    if (!entity) continue;
    const audit: Record<string, { from: unknown; to: unknown }> = {};
    if (change.typeName.from !== change.typeName.to) {
      entity.transactionTypeKey = change.typeName.to === null ? undefined : types.get(change.typeName.to);
      audit['transactionTypeKey'] = change.typeName;
    }
    if (change.counterpartKey.from !== change.counterpartKey.to) {
      entity.transferCounterpartKey = change.counterpartKey.to === null ? undefined : getRef(em, Transaction, change.counterpartKey.to);
      audit['transferCounterpartKey'] = change.counterpartKey;
    }
    await TransactionAuditService.log(em, {
      accountKey: entity.accountKey?.accountKey ?? null,
      actorType: input.actorType,
      appuserKey: entity.appuserKey?.appuserKey ?? 0,
      changes: audit,
      eventType: TransactionAuditEventType.SYSTEM_EDIT,
      source: input.source,
      tenantKey: input.tenantKey,
      transactionKey: entity.transactionKey,
    }, { flush: false });
  }
  await em.flush();
  return result;
}

/**
 * The whole decision, over plain rows: which pairs to dissolve, which leftovers to re-type and which
 * pairs to form. Returns one change per row whose type or counterpart differs from what is stored.
 */
export function planTransfers(rows: TransferRow[]): TransferPlan {
  const state = new Map(rows.map((row) => [row.transactionKey, { ...row }]));
  let pairsDissolved = 0;

  // 1. Dissolve stored pairs that no longer satisfy the rule.
  for (const row of [...state.values()].sort(byKey)) {
    if (row.counterpartKey === null) continue;
    const partner = state.get(row.counterpartKey);
    if (partner && isValidPair(row, partner)) continue;
    if (partner?.counterpartKey === row.transactionKey) {
      partner.counterpartKey = null;
      partner.typeName = restoredType(partner);
    }
    row.counterpartKey = null;
    row.typeName = restoredType(row);
    pairsDissolved += 1;
  }

  // 2. Leftover unpaired synced transfers get their direction's type.
  for (const row of state.values()) {
    if (row.counterpartKey === null && row.synced && !row.userTyped && (row.typeName === TRANSFER_IN || row.typeName === TRANSFER_OUT)) row.typeName = defaultSyncedType(row.cents);
  }

  // 3. Match.
  const pairs = matchPairs([...state.values()].filter(isCandidate));
  for (const [outgoing, incoming] of pairs) {
    outgoing.counterpartKey = incoming.transactionKey;
    incoming.counterpartKey = outgoing.transactionKey;
    if (isRetypeable(outgoing)) outgoing.typeName = TRANSFER_OUT;
    if (isRetypeable(incoming)) incoming.typeName = TRANSFER_IN;
  }

  const changes: TransferRowChange[] = [];
  for (const original of [...rows].sort(byKey)) {
    const next = state.get(original.transactionKey);
    if (!next || (next.typeName === original.typeName && next.counterpartKey === original.counterpartKey)) continue;
    changes.push({ counterpartKey: { from: original.counterpartKey, to: next.counterpartKey }, transactionKey: original.transactionKey, typeName: { from: original.typeName, to: next.typeName } });
  }
  return { changes, pairsDissolved, pairsMatched: pairs.length };
}

/** The type the sync gives a row of this direction. */
function byKey(a: TransferRow, b: TransferRow) {
  return a.transactionKey - b.transactionKey;
}

function defaultSyncedType(cents: number): string {
  return cents < 0 ? PAYMENT : DEPOSIT;
}

function isCandidate(row: TransferRow): boolean {
  if (row.counterpartKey !== null || !row.booked || row.deleted || row.hidden || row.day === null || row.cents === 0) return false;
  if (row.accountKey === null || row.currencyKey === null) return false;
  return isRetypeable(row) || isAnchor(row);
}

/** A synced row still carrying the sync's type for its direction, which no user changed. */
function isRetypeable(row: TransferRow): boolean {
  if (!row.synced || row.userTyped) return false;
  return row.cents > 0 ? row.typeName === DEPOSIT : row.typeName === PAYMENT;
}

/** A row a person typed as a transfer: a manual one, or a synced one a user re-typed. */
function isAnchor(row: TransferRow): boolean {
  if (row.synced && !row.userTyped) return false;
  return row.cents > 0 ? row.typeName === TRANSFER_IN : row.typeName === TRANSFER_OUT;
}

function isValidPair(row: TransferRow, partner: TransferRow): boolean {
  return partner.counterpartKey === row.transactionKey
    && row.booked && partner.booked && !row.deleted && !partner.deleted
    && row.cents !== 0 && row.cents === -partner.cents
    && row.currencyKey !== null && row.currencyKey === partner.currencyKey
    && row.accountKey !== partner.accountKey;
}

/** A row leaving a pair: a synced row gets its direction's type back, unless a user set it. */
function restoredType(row: TransferRow): null | string {
  return row.synced && !row.userTyped ? defaultSyncedType(row.cents) : row.typeName;
}

/** Mutual-unique-closest matching, round by round. Returns [outgoing, incoming] pairs. */
async function loadRows(em: EntityManager, input: TransferReconciliationInput): Promise<Transaction[]> {
  const where: FilterQuery<Transaction> = {
    $or: [
      { transactionTypeKey: { name: { $in: [DEPOSIT, PAYMENT, TRANSFER_IN, TRANSFER_OUT] } } },
      { transferCounterpartKey: { $ne: null } },
    ],
    deletedAt: undefined,
    tenantKey: getRef(em, Tenant, input.tenantKey),
    ...(input.from ? { transactionDate: { $gte: new Date(input.from.getTime() - TRANSFER_MATCH_WINDOW_DAYS * MS_PER_DAY) } } : {}),
  };
  // Hidden rows are read too: a hidden row in a pair stays in it (hiding changes where a row shows,
  // not what it is); it just never forms a new one.
  const options = { filters: { [HIDDEN_FILTER]: false }, populate: ['transactionStatusKey', 'transactionTypeKey'] as const };
  const rows = await em.find(Transaction, where, options);
  // The other half of a stored pair may sit outside the date range, or be soft-deleted: read it too,
  // so a pair is judged on both rows.
  const loaded = new Set(rows.map((row) => row.transactionKey));
  const missing = [...new Set(rows.flatMap((row) => { const key = row.transferCounterpartKey?.transactionKey; return key != null && !loaded.has(key) ? [key] : []; }))];
  if (missing.length === 0) return rows;
  const partners = await em.find(Transaction, { tenantKey: getRef(em, Tenant, input.tenantKey), transactionKey: { $in: missing } }, options);
  return [...rows, ...partners];
}

async function loadTypes(em: EntityManager): Promise<Map<string, TransactionType>> {
  const types = await em.find(TransactionType, { name: { $in: [DEPOSIT, PAYMENT, TRANSFER_IN, TRANSFER_OUT] } });
  return new Map(types.map((type) => [type.name, type]));
}

function matchPairs(candidates: TransferRow[]): [TransferRow, TransferRow][] {
  const incoming = candidates.filter((row) => row.cents > 0).sort(byKey);
  const outgoing = candidates.filter((row) => row.cents < 0).sort(byKey);
  const edges = new Map<number, { distance: number; other: TransferRow }[]>();
  const addEdge = (row: TransferRow, other: TransferRow, distance: number) => { const list = edges.get(row.transactionKey) ?? []; list.push({ distance, other }); edges.set(row.transactionKey, list); };
  for (const out of outgoing) {
    for (const into of incoming) {
      if (into.cents !== -out.cents || into.currencyKey !== out.currencyKey || into.accountKey === out.accountKey) continue;
      if (!isRetypeable(out) && !isRetypeable(into)) continue;
      const distance = Math.abs((into.day ?? 0) - (out.day ?? 0));
      if (distance > TRANSFER_MATCH_WINDOW_DAYS) continue;
      addEdge(out, into, distance);
      addEdge(into, out, distance);
    }
  }

  const taken = new Set<number>();
  const closest = (row: TransferRow): null | TransferRow => {
    const open = (edges.get(row.transactionKey) ?? []).filter((edge) => !taken.has(edge.other.transactionKey));
    if (open.length === 0) return null;
    const best = Math.min(...open.map((edge) => edge.distance));
    const atBest = open.filter((edge) => edge.distance === best);
    return atBest.length === 1 ? atBest[0]?.other ?? null : null;
  };

  const pairs: [TransferRow, TransferRow][] = [];
  for (;;) {
    const round: [TransferRow, TransferRow][] = [];
    for (const out of outgoing) {
      if (taken.has(out.transactionKey)) continue;
      const into = closest(out);
      if (into && closest(into) === out) round.push([out, into]);
    }
    if (round.length === 0) return pairs;
    for (const [out, into] of round) { taken.add(out.transactionKey); taken.add(into.transactionKey); pairs.push([out, into]); }
  }
}

/** Transactions in the tenant whose type a user changed, by the audit log. */
async function loadUserTypedKeys(em: EntityManager, tenantKey: number): Promise<Set<number>> {
  const entries = await em.find(TransactionAuditLog, { actorType: TransactionAuditActorType.USER, tenantKey: getRef(em, Tenant, tenantKey) }, { fields: ['changes', 'transactionKey'] });
  return new Set(entries.filter((entry) => entry.changes != null && Object.hasOwn(entry.changes, 'transactionTypeKey')).map((entry) => entry.transactionKey.transactionKey));
}

function toTransferRow(entity: Transaction, userTyped: Set<number>): TransferRow {
  const amount = entity.settlementAmount == null ? 0 : toNumber(entity.settlementAmount);
  return {
    accountKey: entity.accountKey?.accountKey ?? null,
    booked: entity.transactionStatusKey?.name === 'BOOKED',
    cents: Math.round(roundMoney(amount, 2) * 100),
    counterpartKey: entity.transferCounterpartKey?.transactionKey ?? null,
    currencyKey: entity.settlementCurrencyKey?.currencyKey ?? null,
    day: entity.transactionDate ? Math.floor(new Date(entity.transactionDate).getTime() / MS_PER_DAY) : null,
    deleted: entity.deletedAt != null,
    hidden: entity.hidden,
    synced: entity.enableBankingTransactionId != null || entity.nordigenInternalTransactionId != null,
    transactionKey: entity.transactionKey,
    typeName: entity.transactionTypeKey?.name ?? null,
    userTyped: userTyped.has(entity.transactionKey),
  };
}

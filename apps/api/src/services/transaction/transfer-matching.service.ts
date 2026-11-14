import type { EntityManager, FilterQuery } from '@mikro-orm/core';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { Currency } from '@entity/Currency';
import { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType, TransactionAuditEventType, TransactionAuditLog } from '@entity/TransactionAuditLog';
import { TransactionType } from '@entity/TransactionType';
import { loadAccountAudiences } from '@service/account/account-access';
import { rateScope, resolveExchangeRate } from '@service/currency/exchange-rate';
import { getRef } from '@utils/em-helpers';
import { big, roundMoney, toNumber } from '@utils/money';

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
 * - they have the same settlement currency and the same absolute settlement amount, to the cent, or
 *   they are a pair across currencies (below);
 * - the same people can see both accounts: both shared with the household, or both private to the
 *   same member. A pair re-types both rows, so it must not turn a row one member sees into a
 *   transfer into an account only another member sees;
 * - their dates are at most {@link TRANSFER_MATCH_WINDOW_DAYS} calendar days apart;
 * - each is the other's unique closest candidate. A tie at the closest distance is ambiguous and is
 *   left unpaired. Pairs are accepted round by round, so once a row is taken a tie it was part of may
 *   resolve. The result depends only on the rows, never on the order they were read.
 *
 * ## Across currencies
 *
 * Money sent from a EUR account to a USD account leaves as one amount and arrives as another. O and I
 * in two different settlement currencies are a pair when:
 * - a rate from O's currency to I's is stored for O's date (`resolveExchangeRate`: the latest
 *   published on or before it, however old). With no rate there is no pair: a rate is never assumed;
 * - O's amount converted at that rate is within {@link transferMatchFxTolerance} of I's amount, as a
 *   fraction of I's amount. It absorbs the bank's spread on the rate and a fee taken out of the
 *   amount (2 percent by default, `TRANSFER_MATCH_FX_TOLERANCE`);
 * - the same people can see both accounts, as for an exact pair.
 *
 * Exact same-currency matches are made first, by the rule above, and only the rows they leave take
 * part in matching across currencies: a cross-currency candidate never makes an exact match
 * ambiguous. Both rows of such a pair store the rate the banks settled at (I's amount over O's) in
 * `transferExchangeRate`.
 *
 * ## Which rows take part
 *
 * - **Re-typeable**: a bank-synced row (it has a provider id) still carrying the type the sync gives
 *   its direction, DEPOSIT for money in and PAYMENT for money out, whose type no user changed. Pairing
 *   re-types it.
 * - **Anchor**: a row a person typed as a transfer, unpaired: a manual row typed TRANSFER_IN /
 *   TRANSFER_OUT (a file that states its transfers, such as both sides of a YNAB or QIF transfer,
 *   imports them so), or a synced row a user re-typed so. Pairing links it but never changes its
 *   type. Two anchors pair too: both are already transfers, so the pair only links them.
 * - Never: a manual DEPOSIT or PAYMENT (the person said what it is), CARD_PAYMENT and every other
 *   type, and any row a user re-typed to something other than a transfer.
 *
 * A type is user-set when the audit log has a USER entry that changed `transactionTypeKey`: "mark as
 * transfer" and its undo (`transaction-transfer.service.ts`) write one, so a row a user marked as a
 * transfer is an anchor, and one a user marked as not a transfer never pairs and leaves any pair it
 * was in (the pair is no longer valid once either row is not typed as a transfer). A row created through
 * `createTransaction` records its type that way, so a generic CSV row, which stores the file's id
 * like a synced row, keeps the type its file gave it.
 *
 * ## Upkeep, before matching
 *
 * - A stored pair that no longer satisfies the rule (one side expired, deleted, re-amounted, no
 *   longer pointing back, or across a privacy line; across currencies, also out of tolerance at the
 *   stored rate) is dissolved. A synced side gets its direction's type back, unless a user
 *   set it; a manual side keeps its type. A private side is only ever changed on its own account,
 *   which no other member can see.
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

/**
 * How far O's converted amount may be from I's amount in a pair across currencies, as a fraction of
 * I's. It has to absorb the bank's margin over the reference (ECB) rate, a fee taken out of the
 * amount, and the move between the rate the bank used during the day and the one the ECB published
 * for it. Wider would mostly add false pairs between unrelated amounts in the matching window.
 * Configurable because margins differ between banks (`TRANSFER_MATCH_FX_TOLERANCE`, at most 0.25).
 */
export const DEFAULT_TRANSFER_MATCH_FX_TOLERANCE = 0.02;
const MAX_TRANSFER_MATCH_FX_TOLERANCE = 0.25;

const DEPOSIT = 'DEPOSIT';
const PAYMENT = 'PAYMENT';
const TRANSFER_IN = 'TRANSFER_IN';
const TRANSFER_OUT = 'TRANSFER_OUT';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** What the planner needs to judge pairs across currencies. Plain data and a lookup: no queries. */
export interface TransferPlanOptions {
  /** Largest accepted gap between O's converted amount and I's amount, as a fraction of I's. */
  fxTolerance: number;
  /** The stored rate from one currency to another for a calendar day, or null when none is stored. */
  rateOn(fromCurrencyKey: number, toCurrencyKey: number, day: number): null | number;
}

/** No rates: nothing pairs across currencies. */
const SAME_CURRENCY_ONLY: TransferPlanOptions = { fxTolerance: 0, rateOn: () => null };

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
  /**
   * Who may see the row's account: null for the whole household, else the account's audience (its
   * owner and the members it is shared with, `accountAudience` in `account-access.ts`).
   */
  privateTo: null | string;
  synced: boolean;
  transactionKey: number;
  /** The stored `transferExchangeRate`. */
  transferRate: null | number;
  typeName: null | string;
  userTyped: boolean;
}

export interface TransferRowChange {
  counterpartKey: { from: null | number; to: null | number };
  transactionKey: number;
  transferRate: { from: null | number; to: null | number };
  typeName: { from: null | string; to: null | string };
}

export async function reconcileTransfers(em: EntityManager, input: TransferReconciliationInput): Promise<TransferReconciliationResult> {
  // A row with no owner cannot be audited, so it is never changed (and never pairs).
  const entities = (await loadRows(em, input)).filter((entity) => entity.appuserKey != null);
  const userTyped = await loadUserTypedKeys(em, input.tenantKey);
  const audiences = await loadAccountAudiences(em, entities.flatMap((entity) => (entity.accountKey ? [entity.accountKey.accountKey] : [])));
  const rows = entities.map((entity) => toTransferRow(entity, userTyped, audiences));
  const plan = planTransfers(rows, { fxTolerance: transferMatchFxTolerance(), rateOn: await loadRates(em, rows, input.tenantKey) });
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
    if (change.transferRate.from !== change.transferRate.to) {
      entity.transferExchangeRate = change.transferRate.to;
      audit['transferExchangeRate'] = change.transferRate;
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

/** The cross-currency tolerance from `TRANSFER_MATCH_FX_TOLERANCE` (validated at boot), or the default. */
export function transferMatchFxTolerance(value = process.env['TRANSFER_MATCH_FX_TOLERANCE']): number {
  const parsed = value?.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_TRANSFER_MATCH_FX_TOLERANCE ? parsed : DEFAULT_TRANSFER_MATCH_FX_TOLERANCE;
}

/**
 * The whole decision, over plain rows: which pairs to dissolve, which leftovers to re-type and which
 * pairs to form. Returns one change per row whose type, counterpart or rate differs from what is stored.
 */
export function planTransfers(rows: TransferRow[], options: TransferPlanOptions = SAME_CURRENCY_ONLY): TransferPlan {
  const state = new Map(rows.map((row) => [row.transactionKey, { ...row }]));
  let pairsDissolved = 0;

  // 1. Dissolve stored pairs that no longer satisfy the rule. A pair that does keeps (or gets back)
  // the rate it implies.
  for (const row of [...state.values()].sort(byKey)) {
    if (row.counterpartKey === null) continue;
    const partner = state.get(row.counterpartKey);
    if (partner && isValidPair(row, partner, options)) {
      row.transferRate = pairRate(row, partner);
      continue;
    }
    if (partner?.counterpartKey === row.transactionKey) {
      partner.counterpartKey = null;
      partner.typeName = restoredType(partner);
    }
    row.counterpartKey = null;
    row.typeName = restoredType(row);
    pairsDissolved += 1;
  }

  // 2. Leftover unpaired synced transfers get their direction's type; no unpaired row keeps a rate.
  for (const row of state.values()) {
    if (row.counterpartKey === null && row.synced && !row.userTyped && (row.typeName === TRANSFER_IN || row.typeName === TRANSFER_OUT)) row.typeName = defaultSyncedType(row.cents);
    if (row.counterpartKey === null) row.transferRate = null;
  }

  // 3. Match.
  const pairs = matchPairs([...state.values()].filter(isCandidate), options);
  for (const [outgoing, incoming] of pairs) {
    outgoing.counterpartKey = incoming.transactionKey;
    incoming.counterpartKey = outgoing.transactionKey;
    outgoing.transferRate = pairRate(outgoing, incoming);
    incoming.transferRate = outgoing.transferRate;
    if (isRetypeable(outgoing)) outgoing.typeName = TRANSFER_OUT;
    if (isRetypeable(incoming)) incoming.typeName = TRANSFER_IN;
  }

  const changes: TransferRowChange[] = [];
  for (const original of [...rows].sort(byKey)) {
    const next = state.get(original.transactionKey);
    if (!next || (next.typeName === original.typeName && next.counterpartKey === original.counterpartKey && next.transferRate === original.transferRate)) continue;
    changes.push({
      counterpartKey: { from: original.counterpartKey, to: next.counterpartKey },
      transactionKey: original.transactionKey,
      transferRate: { from: original.transferRate, to: next.transferRate },
      typeName: { from: original.typeName, to: next.typeName },
    });
  }
  return { changes, pairsDissolved, pairsMatched: pairs.length };
}

/**
 * Which rates to resolve before planning: one per currency pair and outgoing day, for every two rows
 * that could be judged across currencies (within the window, or a stored pair). A superset of what
 * the planner asks for, since upkeep can free a row to pair again.
 */
function rateLookups(rows: TransferRow[]): { day: number; fromCurrencyKey: number; toCurrencyKey: number }[] {
  const lookups = new Map<string, { day: number; fromCurrencyKey: number; toCurrencyKey: number }>();
  const add = (out: TransferRow, into: TransferRow) => {
    if (out.currencyKey === null || into.currencyKey === null || out.currencyKey === into.currencyKey || out.day === null) return;
    lookups.set(`${out.currencyKey}>${into.currencyKey}@${out.day}`, { day: out.day, fromCurrencyKey: out.currencyKey, toCurrencyKey: into.currencyKey });
  };
  const live = rows.filter((row) => row.booked && !row.deleted && row.day !== null && row.accountKey !== null && row.cents !== 0);
  const incoming = live.filter((row) => row.cents > 0);
  for (const out of live) {
    if (out.cents > 0) continue;
    for (const into of incoming) {
      if (into.accountKey !== out.accountKey && Math.abs((into.day ?? 0) - (out.day ?? 0)) <= TRANSFER_MATCH_WINDOW_DAYS) add(out, into);
    }
  }
  const byKeyMap = new Map(rows.map((row) => [row.transactionKey, row]));
  for (const row of rows) {
    const partner = row.counterpartKey === null ? undefined : byKeyMap.get(row.counterpartKey);
    if (partner && row.cents < 0 && partner.cents > 0) add(row, partner);
  }
  return [...lookups.values()];
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

function isTransferType(row: TransferRow): boolean {
  return row.typeName === TRANSFER_IN || row.typeName === TRANSFER_OUT;
}

function isValidPair(row: TransferRow, partner: TransferRow, options: TransferPlanOptions): boolean {
  // Pairing types both rows as transfers; a row a user has since re-typed as something else
  // (PATCH /transaction/:id, "not a transfer") has left the pair.
  const linked = partner.counterpartKey === row.transactionKey
    && isTransferType(row) && isTransferType(partner)
    && row.booked && partner.booked && !row.deleted && !partner.deleted
    && row.cents !== 0
    && row.currencyKey !== null && partner.currencyKey !== null
    && row.accountKey !== partner.accountKey
    && sameVisibility(row, partner);
  if (!linked) return false;
  if (row.currencyKey === partner.currencyKey) return row.cents === -partner.cents;
  if (Math.sign(row.cents) === Math.sign(partner.cents)) return false;
  return row.cents < 0 ? acceptsAcrossCurrencies(row, partner, options) : acceptsAcrossCurrencies(partner, row, options);
}

/** Whether the same people can see both accounts: both shared, or both private and seen by exactly the same members. */
function sameVisibility(a: TransferRow, b: TransferRow): boolean {
  return a.privateTo === b.privateTo;
}

/**
 * Whether O and I, in two different currencies, are the same money: O converted at the stored rate
 * for its day is within the tolerance of I, and the same people can see both accounts.
 */
function acceptsAcrossCurrencies(out: TransferRow, into: TransferRow, options: TransferPlanOptions): boolean {
  if (out.currencyKey === null || into.currencyKey === null || out.currencyKey === into.currencyKey || out.day === null) return false;
  if (out.cents >= 0 || into.cents <= 0 || !sameVisibility(out, into)) return false;
  const rate = options.rateOn(out.currencyKey, into.currencyKey, out.day);
  if (rate === null || !(rate > 0)) return false;
  const received = big(into.cents);
  return big(-out.cents).times(rate).minus(received).abs().lte(received.times(options.fxTolerance));
}

/** The rate a pair implies (I's amount over O's), or null for a same-currency pair. */
function pairRate(row: TransferRow, partner: TransferRow): null | number {
  if (row.currencyKey === partner.currencyKey) return null;
  const [out, into] = row.cents < 0 ? [row, partner] : [partner, row];
  return toNumber(big(into.cents).div(-out.cents), 8);
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
  const options = { filters: { [HIDDEN_FILTER]: false }, populate: ['accountKey', 'transactionStatusKey', 'transactionTypeKey'] as const };
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

function matchPairs(candidates: TransferRow[], options: TransferPlanOptions): [TransferRow, TransferRow][] {
  const incoming = candidates.filter((row) => row.cents > 0).sort(byKey);
  const outgoing = candidates.filter((row) => row.cents < 0).sort(byKey);
  const edges = new Map<number, { distance: number; exact: boolean; other: TransferRow }[]>();
  const addEdge = (row: TransferRow, other: TransferRow, distance: number, exact: boolean) => { const list = edges.get(row.transactionKey) ?? []; list.push({ distance, exact, other }); edges.set(row.transactionKey, list); };
  for (const out of outgoing) {
    for (const into of incoming) {
      if (into.accountKey === out.accountKey) continue;
      const distance = Math.abs((into.day ?? 0) - (out.day ?? 0));
      if (distance > TRANSFER_MATCH_WINDOW_DAYS) continue;
      const exact = into.currencyKey === out.currencyKey;
      if (exact ? into.cents !== -out.cents || !sameVisibility(out, into) : !acceptsAcrossCurrencies(out, into, options)) continue;
      addEdge(out, into, distance, exact);
      addEdge(into, out, distance, exact);
    }
  }

  const taken = new Set<number>();
  const closest = (row: TransferRow, exactOnly: boolean): null | TransferRow => {
    const open = (edges.get(row.transactionKey) ?? []).filter((edge) => (edge.exact || !exactOnly) && !taken.has(edge.other.transactionKey));
    if (open.length === 0) return null;
    const best = Math.min(...open.map((edge) => edge.distance));
    const atBest = open.filter((edge) => edge.distance === best);
    return atBest.length === 1 ? atBest[0]?.other ?? null : null;
  };

  // Exact matches first, until none is left; then, over the rows they leave, every match.
  const pairs: [TransferRow, TransferRow][] = [];
  for (const exactOnly of [true, false]) {
    for (;;) {
      const round: [TransferRow, TransferRow][] = [];
      for (const out of outgoing) {
        if (taken.has(out.transactionKey)) continue;
        const into = closest(out, exactOnly);
        if (into && closest(into, exactOnly) === out) round.push([out, into]);
      }
      if (round.length === 0) break;
      for (const [out, into] of round) { taken.add(out.transactionKey); taken.add(into.transactionKey); pairs.push([out, into]); }
    }
  }
  return pairs;
}

/**
 * Every rate the planner may ask for, resolved once each through {@link resolveExchangeRate}. A
 * provisional (old) rate is used as it is; a missing one stays null, so that pair is never made.
 * The household's own exchange-rate overrides count, as they do for every other conversion.
 */
async function loadRates(em: EntityManager, rows: TransferRow[], tenantKey: number): Promise<TransferPlanOptions['rateOn']> {
  const rates = new Map<string, null | number>();
  const scope = rateScope(tenantKey);
  for (const lookup of rateLookups(rows)) {
    const resolved = await resolveExchangeRate(em, getRef(em, Currency, lookup.fromCurrencyKey), getRef(em, Currency, lookup.toCurrencyKey), new Date(lookup.day * MS_PER_DAY), scope);
    rates.set(`${lookup.fromCurrencyKey}>${lookup.toCurrencyKey}@${lookup.day}`, resolved?.rate ?? null);
  }
  return (fromCurrencyKey, toCurrencyKey, day) => rates.get(`${fromCurrencyKey}>${toCurrencyKey}@${day}`) ?? null;
}

/** Transactions in the tenant whose type a user changed, by the audit log. */
async function loadUserTypedKeys(em: EntityManager, tenantKey: number): Promise<Set<number>> {
  const entries = await em.find(TransactionAuditLog, { actorType: TransactionAuditActorType.USER, tenantKey: getRef(em, Tenant, tenantKey) }, { fields: ['changes', 'transactionKey'] });
  return new Set(entries.filter((entry) => entry.changes != null && Object.hasOwn(entry.changes, 'transactionTypeKey')).map((entry) => entry.transactionKey.transactionKey));
}

function toTransferRow(entity: Transaction, userTyped: Set<number>, audiences: ReadonlyMap<number, string>): TransferRow {
  const amount = entity.settlementAmount == null ? 0 : toNumber(entity.settlementAmount);
  const account = entity.accountKey;
  return {
    accountKey: account?.accountKey ?? null,
    booked: entity.transactionStatusKey?.name === 'BOOKED',
    cents: Math.round(roundMoney(amount, 2) * 100),
    counterpartKey: entity.transferCounterpartKey?.transactionKey ?? null,
    currencyKey: entity.settlementCurrencyKey?.currencyKey ?? null,
    day: entity.transactionDate ? Math.floor(new Date(entity.transactionDate).getTime() / MS_PER_DAY) : null,
    deleted: entity.deletedAt != null,
    hidden: entity.hidden,
    privateTo: account?.isPrivate ? (audiences.get(account.accountKey) ?? '') : null,
    synced: entity.enableBankingTransactionId != null || entity.nordigenInternalTransactionId != null,
    transactionKey: entity.transactionKey,
    transferRate: entity.transferExchangeRate == null ? null : toNumber(entity.transferExchangeRate, 8),
    typeName: entity.transactionTypeKey?.name ?? null,
    userTyped: userTyped.has(entity.transactionKey),
  };
}

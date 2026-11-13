import type { EntityManager } from '@mikro-orm/core';

import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { Account } from '@entity/Account';
import type { Appuser } from '@entity/Appuser';
import { Category } from '@entity/Category';
import { CreditCardDetail } from '@entity/CreditCardDetail';
import { Installment } from '@entity/Installment';
import { InstallmentPlan } from '@entity/InstallmentPlan';
import type { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { type CreditCardCycle, toCalendarDate, utcDayNumber } from '@service/account/credit-card-cycle';
import { EXPIRED_TRANSACTION_STATUS } from '@service/transaction/transaction-status';
import { BadRequestError, ConflictError, NotFoundError } from '@utils/errors';
import { roundDisplay, toNumber } from '@utils/money';

import { normalizeInstallmentStem, parseInstallmentMarker } from './installment-description';
import { buildInstallmentSchedule, installmentStatus, type InstallmentStatus, startOfUtcDay } from './installment-schedule';
import { buildInstallmentSuggestions, type InstallmentSuggestion } from './installment-suggestions';

/**
 * Installment plans: a card purchase split into fixed monthly installments.
 *
 * **Projections only.** A plan stores its future installments as {@link Installment} schedule
 * rows, never as transactions, so nothing about a plan changes a balance, net worth, the
 * transaction lists or a budget. A schedule row is `paid` while a live posted transaction carries
 * its plan and number (`Transaction.installmentPlanKey` + `installmentNumber`); the bank's row is
 * then the only record of the money, so a posted installment can never be counted twice.
 *
 * **Scoping.** Every read goes through the request's tenant filter: a plan follows its card, so the
 * other member's private card's plans, like another household's, do not exist for the caller.
 * Account and transaction lookups go through the same filter.
 */

const DAY_MS = 86_400_000;
/** A posted installment may land this many days outside its plan's schedule and still match. */
const MATCH_MARGIN_DAYS = 62;
/** How far back suggestions look for posted installments. */
const SUGGESTION_LOOKBACK_DAYS = 550;

export interface CreateInstallmentPlanInput {
  accountKey: number;
  categoryKey?: null | number;
  description: string;
  installmentCount: number;
  links?: { installmentNumber: number; transactionKey: number }[];
  purchaseDate: Date;
  totalAmount: number;
}

export interface InstallmentCommitmentDto {
  accountKey: number;
  accountName: string;
  activePlanCount: number;
  currency: string;
  nextInstallment: null | { amount: number; date: string; description: string; installmentCount: number; installmentNumber: number; installmentPlanKey: number };
  remainingAmount: number;
  remainingCount: number;
}

export interface InstallmentDto {
  amount: number;
  dueDate: null | string;
  installmentNumber: number;
  postedAmount: null | number;
  postedDate: null | string;
  scheduledDate: string;
  statementDate: null | string;
  status: InstallmentStatus;
  transactionKey: null | number;
}

export interface InstallmentPlanContext {
  tenant: Tenant;
  tenantKey: number;
  user: Appuser;
}

export interface InstallmentPlanDetailDto extends InstallmentPlanDto {
  installments: InstallmentDto[];
}

export interface InstallmentPlanDto {
  accountKey: number;
  accountName: string;
  categoryKey: null | number;
  currency: string;
  description: string;
  installmentCount: number;
  installmentPlanKey: number;
  nextInstallment: InstallmentDto | null;
  paidAmount: number;
  paidCount: number;
  purchaseDate: string;
  remainingAmount: number;
  remainingCount: number;
  totalAmount: number;
  unmatchedCount: number;
}

export interface InstallmentSuggestionDto extends InstallmentSuggestion {
  accountName: string;
  currency: string;
}

export interface UpdateInstallmentPlanInput {
  categoryKey?: null | number;
  description?: string;
  installmentCount?: number;
  purchaseDate?: Date;
  totalAmount?: number;
}

/** A posted row linked to a plan, as the schedule reads it. */
interface PostedRow {
  amount: null | number;
  date: Date | null;
  installmentNumber: number;
  planKey: number;
  transactionKey: number;
}

const roundCents = (amount: number) => Math.round(amount * 100) / 100;

async function cycleFor(em: EntityManager, accountKey: number): Promise<CreditCardCycle | null> {
  const detail = await em.findOne(CreditCardDetail, { accountKey: { accountKey }, deletedAt: null });
  return detail ? { paymentDueDay: detail.paymentDueDay, statementCloseDay: detail.statementCloseDay } : null;
}

/** The live posted rows linked to these plans, by plan. A dropped (EXPIRED) row never paid anything. */
async function loadPostedRows(em: EntityManager, planKeys: number[]): Promise<Map<number, PostedRow[]>> {
  const byPlan = new Map<number, PostedRow[]>();
  if (planKeys.length === 0) return byPlan;
  const rows = await em.find(
    Transaction,
    { deletedAt: null, installmentPlanKey: { installmentPlanKey: { $in: planKeys } } },
    { filters: { [HIDDEN_FILTER]: false }, populate: ['transactionStatusKey'] },
  );
  for (const row of rows) {
    if (!row.installmentPlanKey || row.installmentNumber == null) continue;
    if (row.transactionStatusKey?.name === EXPIRED_TRANSACTION_STATUS) continue;
    const planKey = row.installmentPlanKey.installmentPlanKey;
    const list = byPlan.get(planKey) ?? [];
    list.push({ amount: row.settlementAmount ?? null, date: row.transactionDate ?? null, installmentNumber: row.installmentNumber, planKey, transactionKey: row.transactionKey });
    byPlan.set(planKey, list);
  }
  return byPlan;
}

function toInstallmentDto(row: Installment, posted: PostedRow | undefined, today: Date): InstallmentDto {
  return {
    amount: toNumber(row.amount),
    dueDate: row.dueDate ? toCalendarDate(row.dueDate) : null,
    installmentNumber: row.installmentNumber,
    postedAmount: posted?.amount == null ? null : roundDisplay(Math.abs(posted.amount)),
    postedDate: posted?.date ? toCalendarDate(posted.date) : null,
    scheduledDate: toCalendarDate(row.scheduledDate),
    statementDate: row.statementDate ? toCalendarDate(row.statementDate) : null,
    status: installmentStatus({ linked: posted !== undefined, scheduledDate: row.scheduledDate }, today),
    transactionKey: posted?.transactionKey ?? null,
  };
}

/** Plans as the API returns them, each with its schedule and where every installment stands. */
export async function describePlans(em: EntityManager, plans: InstallmentPlan[], today: Date): Promise<InstallmentPlanDetailDto[]> {
  const planKeys = plans.map((plan) => plan.installmentPlanKey);
  const [schedule, posted] = await Promise.all([
    planKeys.length === 0 ? [] : em.find(Installment, { deletedAt: null, installmentPlanKey: { installmentPlanKey: { $in: planKeys } } }, { orderBy: { installmentNumber: 'asc' } }),
    loadPostedRows(em, planKeys),
  ]);
  const scheduleByPlan = new Map<number, Installment[]>();
  for (const row of schedule) {
    const key = row.installmentPlanKey.installmentPlanKey;
    scheduleByPlan.set(key, [...(scheduleByPlan.get(key) ?? []), row]);
  }

  return plans.map((plan) => {
    const postedByNumber = new Map((posted.get(plan.installmentPlanKey) ?? []).map((row) => [row.installmentNumber, row]));
    const installments = (scheduleByPlan.get(plan.installmentPlanKey) ?? []).map((row) => toInstallmentDto(row, postedByNumber.get(row.installmentNumber), today));
    const paid = installments.filter((row) => row.status === 'paid');
    const upcoming = installments.filter((row) => row.status === 'upcoming');
    return {
      accountKey: plan.accountKey.accountKey,
      accountName: plan.accountKey.accountName ?? '',
      categoryKey: plan.categoryKey?.categoryKey ?? null,
      currency: plan.accountKey.currencyKey.code,
      description: plan.description,
      installmentCount: plan.installmentCount,
      installmentPlanKey: plan.installmentPlanKey,
      installments,
      nextInstallment: upcoming[0] ?? null,
      paidAmount: roundCents(paid.reduce((sum, row) => sum + row.amount, 0)),
      paidCount: paid.length,
      purchaseDate: toCalendarDate(plan.purchaseDate),
      remainingAmount: roundCents(upcoming.reduce((sum, row) => sum + row.amount, 0)),
      remainingCount: upcoming.length,
      totalAmount: toNumber(plan.totalAmount),
      unmatchedCount: installments.filter((row) => row.status === 'unmatched').length,
    };
  });
}

/** Drop the schedule array for list views. */
export function summarizePlan({ installments: _installments, ...plan }: InstallmentPlanDetailDto): InstallmentPlanDto {
  return plan;
}

const PLAN_POPULATE = ['accountKey', 'accountKey.currencyKey', 'categoryKey'] as const;

/** The plans the caller can see, newest purchase first. */
export async function listPlans(em: EntityManager, input: { accountKey?: number; tenantKey: number }): Promise<InstallmentPlan[]> {
  return em.find(
    InstallmentPlan,
    {
      accountKey: { deletedAt: null, ...(input.accountKey === undefined ? {} : { accountKey: input.accountKey }) },
      deletedAt: null,
      tenantKey: { tenantKey: input.tenantKey },
    },
    { orderBy: [{ purchaseDate: 'desc' }, { installmentPlanKey: 'desc' }], populate: PLAN_POPULATE },
  );
}

/** One plan the caller can see, or a 404: another household's, or one on the other member's private card, does not exist. */
export async function describePlan(em: EntityManager, plan: InstallmentPlan, today: Date): Promise<InstallmentPlanDetailDto> {
  const [described] = await describePlans(em, [plan], today);
  if (!described) throw new NotFoundError(`Installment plan not found: ${plan.installmentPlanKey}`);
  return described;
}

export async function findPlanOrFail(em: EntityManager, installmentPlanKey: number, tenantKey: number): Promise<InstallmentPlan> {
  const plan = await em.findOne(
    InstallmentPlan,
    { accountKey: { deletedAt: null }, deletedAt: null, installmentPlanKey, tenantKey: { tenantKey } },
    { populate: PLAN_POPULATE },
  );
  if (!plan) throw new NotFoundError(`Installment plan not found: ${installmentPlanKey}`);
  return plan;
}

async function findAccountOrFail(em: EntityManager, accountKey: number, tenantKey: number): Promise<Account> {
  const account = await em.findOne(Account, { accountKey, deletedAt: null, tenantKey: { tenantKey } }, { populate: ['currencyKey'] });
  if (!account) throw new NotFoundError(`Account not found: ${accountKey}`);
  return account;
}

async function findCategoryOrFail(em: EntityManager, categoryKey: number, tenantKey: number): Promise<Category> {
  const category = await em.findOne(Category, { $or: [{ tenantKey: { tenantKey } }, { tenantKey: null }], categoryKey, deletedAt: null });
  if (!category) throw new BadRequestError(`Category not found: ${categoryKey}`);
  return category;
}

/** Rewrite a plan's schedule from its amount, count, purchase date and its card's cycle. */
async function writeSchedule(em: EntityManager, plan: InstallmentPlan): Promise<void> {
  await em.nativeDelete(Installment, { installmentPlanKey: { installmentPlanKey: plan.installmentPlanKey } }, { filters: false });
  const cycle = await cycleFor(em, plan.accountKey.accountKey);
  for (const row of buildInstallmentSchedule({ cycle, installmentCount: plan.installmentCount, purchaseDate: plan.purchaseDate, totalAmount: toNumber(plan.totalAmount) })) {
    em.create(Installment, { ...row, installmentPlanKey: plan, tenantKey: plan.tenantKey }, { partial: true });
  }
  await em.flush();
}

/**
 * Link a posted transaction to installment `installmentNumber` of `plan`. The transaction must be a
 * live row the caller can see, on the plan's card, and not already paying an installment; the
 * installment must not already be paid. Flushes nothing.
 */
export async function createInstallmentPlan(em: EntityManager, input: CreateInstallmentPlanInput, context: InstallmentPlanContext): Promise<InstallmentPlan> {
  const account = await findAccountOrFail(em, input.accountKey, context.tenantKey);
  const category = input.categoryKey == null ? null : await findCategoryOrFail(em, input.categoryKey, context.tenantKey);
  const links = input.links ?? [];
  if (new Set(links.map((link) => link.installmentNumber)).size !== links.length) throw new BadRequestError('Each installment can be linked once');
  if (new Set(links.map((link) => link.transactionKey)).size !== links.length) throw new BadRequestError('Each transaction can pay one installment');

  return em.transactional(async (tx) => {
    const plan = tx.create(InstallmentPlan, {
      accountKey: account,
      categoryKey: category,
      createdByAppuserKey: context.user,
      description: input.description,
      installmentCount: input.installmentCount,
      purchaseDate: startOfUtcDay(input.purchaseDate),
      tenantKey: context.tenant,
      totalAmount: roundCents(input.totalAmount),
    }, { partial: true });
    await tx.flush();
    await writeSchedule(tx, plan);
    for (const link of links) await assignTransaction(tx, plan, link.installmentNumber, link.transactionKey);
    await tx.flush();
    await linkPostedInstallments(tx, { planKeys: [plan.installmentPlanKey], tenantKey: context.tenantKey });
    return plan;
  });
}

export async function updateInstallmentPlan(em: EntityManager, plan: InstallmentPlan, input: UpdateInstallmentPlanInput, context: InstallmentPlanContext): Promise<void> {
  if (input.description !== undefined) plan.description = input.description;
  if (input.categoryKey !== undefined) plan.categoryKey = input.categoryKey === null ? null : await findCategoryOrFail(em, input.categoryKey, context.tenantKey);

  const reschedules = input.installmentCount !== undefined || input.purchaseDate !== undefined || input.totalAmount !== undefined;
  if (!reschedules) {
    await em.flush();
    return;
  }

  const count = input.installmentCount ?? plan.installmentCount;
  const posted = (await loadPostedRows(em, [plan.installmentPlanKey])).get(plan.installmentPlanKey) ?? [];
  const highestPaid = Math.max(0, ...posted.map((row) => row.installmentNumber));
  if (count < highestPaid) throw new BadRequestError(`Installment ${highestPaid} is already paid; the plan cannot have fewer installments`);

  await em.transactional(async (tx) => {
    plan.installmentCount = count;
    if (input.purchaseDate !== undefined) plan.purchaseDate = startOfUtcDay(input.purchaseDate);
    if (input.totalAmount !== undefined) plan.totalAmount = roundCents(input.totalAmount);
    tx.persist(plan);
    await tx.flush();
    await writeSchedule(tx, plan);
    await linkPostedInstallments(tx, { planKeys: [plan.installmentPlanKey], tenantKey: context.tenantKey });
  });
}

async function assignTransaction(em: EntityManager, plan: InstallmentPlan, installmentNumber: number, transactionKey: number): Promise<void> {
  if (installmentNumber > plan.installmentCount) throw new BadRequestError(`Installment ${installmentNumber} is past the plan's ${plan.installmentCount}`);
  const transaction = await em.findOne(Transaction, { deletedAt: null, transactionKey }, { filters: { [HIDDEN_FILTER]: false } });
  if (!transaction) throw new NotFoundError(`Transaction not found: ${transactionKey}`);
  if (transaction.accountKey?.accountKey !== plan.accountKey.accountKey) throw new BadRequestError('The transaction is not on the plan\'s account');
  const current = transaction.installmentPlanKey?.installmentPlanKey;
  if (current != null && (current !== plan.installmentPlanKey || transaction.installmentNumber !== installmentNumber)) {
    throw new ConflictError('The transaction already pays another installment');
  }
  const holder = await em.findOne(Transaction, { deletedAt: null, installmentNumber, installmentPlanKey: { installmentPlanKey: plan.installmentPlanKey } }, { filters: { [HIDDEN_FILTER]: false } });
  if (holder && holder.transactionKey !== transaction.transactionKey) throw new ConflictError(`Installment ${installmentNumber} is already paid by another transaction`);
  transaction.installmentPlanKey = plan;
  transaction.installmentNumber = installmentNumber;
  // Linking by hand takes back an earlier manual unlink from this plan.
  if (transaction.installmentUnlinkedPlanKey?.installmentPlanKey === plan.installmentPlanKey) transaction.installmentUnlinkedPlanKey = null;
}

/** Delete a plan and its schedule. Its posted transactions stay, no longer linked, and forget being unlinked from it. */
export async function deleteInstallmentPlan(em: EntityManager, plan: InstallmentPlan): Promise<void> {
  await em.transactional(async (tx) => {
    await tx.nativeUpdate(Transaction, { installmentPlanKey: { installmentPlanKey: plan.installmentPlanKey } }, { installmentNumber: null, installmentPlanKey: null }, { filters: false });
    await tx.nativeUpdate(Transaction, { installmentUnlinkedPlanKey: { installmentPlanKey: plan.installmentPlanKey } }, { installmentUnlinkedPlanKey: null }, { filters: false });
    await tx.nativeDelete(Installment, { installmentPlanKey: { installmentPlanKey: plan.installmentPlanKey } }, { filters: false });
    plan.deletedAt = new Date();
    tx.persist(plan);
    await tx.flush();
  });
}

export async function linkInstallment(em: EntityManager, plan: InstallmentPlan, installmentNumber: number, transactionKey: number): Promise<void> {
  await assignTransaction(em, plan, installmentNumber, transactionKey);
  await em.flush();
}

/**
 * The installment is no longer paid by the row linked to it. The row remembers the plan it was
 * unlinked from, so the automatic linker does not link it to that plan again on the next sync;
 * {@link linkInstallment} to the same plan clears that.
 */
export async function unlinkInstallment(em: EntityManager, plan: InstallmentPlan, installmentNumber: number): Promise<void> {
  const rows = await em.find(Transaction, { installmentNumber, installmentPlanKey: { installmentPlanKey: plan.installmentPlanKey } }, { filters: { [HIDDEN_FILTER]: false } });
  for (const row of rows) {
    row.installmentPlanKey = null;
    row.installmentNumber = null;
    row.installmentUnlinkedPlanKey = plan;
  }
  await em.flush();
}

/** What is still to come on each card with a plan: the sum of the upcoming installments. */
export async function listCommitments(em: EntityManager, input: { accountKey?: number; tenantKey: number; today: Date }): Promise<InstallmentCommitmentDto[]> {
  const plans = await listPlans(em, input);
  const described = await describePlans(em, plans, input.today);
  const byAccount = new Map<number, InstallmentCommitmentDto & { nextDay: number }>();
  for (const plan of described) {
    const entry = byAccount.get(plan.accountKey) ?? {
      accountKey: plan.accountKey,
      accountName: plan.accountName,
      activePlanCount: 0,
      currency: plan.currency,
      nextDay: Number.POSITIVE_INFINITY,
      nextInstallment: null,
      remainingAmount: 0,
      remainingCount: 0,
    };
    entry.remainingAmount = roundCents(entry.remainingAmount + plan.remainingAmount);
    entry.remainingCount += plan.remainingCount;
    if (plan.remainingCount > 0) entry.activePlanCount += 1;
    const next = plan.nextInstallment;
    if (next) {
      const day = utcDayNumber(new Date(`${next.scheduledDate}T00:00:00.000Z`));
      if (day < entry.nextDay) {
        entry.nextDay = day;
        entry.nextInstallment = { amount: next.amount, date: next.scheduledDate, description: plan.description, installmentCount: plan.installmentCount, installmentNumber: next.installmentNumber, installmentPlanKey: plan.installmentPlanKey };
      }
    }
    byAccount.set(plan.accountKey, entry);
  }
  return [...byAccount.values()].map(({ nextDay: _nextDay, ...entry }) => entry).sort((a, b) => a.accountKey - b.accountKey);
}

/**
 * Suggested plans from the caller's visible, unlinked posted rows whose description carries an
 * installment marker. Read-only: accepting one is a `createInstallmentPlan` with its links.
 */
export async function listSuggestions(em: EntityManager, input: { accountKey?: number; tenantKey: number; today: Date }): Promise<InstallmentSuggestionDto[]> {
  const since = new Date(startOfUtcDay(input.today).getTime() - SUGGESTION_LOOKBACK_DAYS * DAY_MS);
  const rows = await em.find(
    Transaction,
    {
      accountKey: { deletedAt: null, ...(input.accountKey === undefined ? {} : { accountKey: input.accountKey }) },
      deletedAt: null,
      // A cheap pre-filter; the parser decides.
      description: { $re: String.raw`\d{1,3}\s*(/|de |of )\s*\d{1,3}` },
      installmentPlanKey: null,
      settlementAmount: { $lt: 0 },
      tenantKey: { tenantKey: input.tenantKey },
      transactionDate: { $gte: since },
    },
    { populate: ['accountKey', 'accountKey.currencyKey'] },
  );
  const accounts = new Map(rows.flatMap((row) => (row.accountKey ? [[row.accountKey.accountKey, row.accountKey] as const] : [])));
  const suggestions = buildInstallmentSuggestions(rows.flatMap((row) => (row.accountKey && row.transactionDate && row.settlementAmount != null && row.description
    ? [{ accountKey: row.accountKey.accountKey, amount: toNumber(row.settlementAmount), description: row.description, transactionDate: row.transactionDate, transactionKey: row.transactionKey }]
    : [])));
  return suggestions.map((suggestion) => {
    const account = accounts.get(suggestion.accountKey);
    return { ...suggestion, accountName: account?.accountName ?? '', currency: account?.currencyKey.code ?? '' };
  });
}

/**
 * Link posted bank rows to the installments they pay, so a posted installment reads as paid
 * instead of being counted next to its projection. Run after a sync or an import and when a plan
 * is created or rescheduled; idempotent, and it never unlinks.
 *
 * A row is linked only when it is a charge on the plan's card whose description names the
 * installment (`PARC 03/12`: number 3 of a 12-installment plan), whose amount is that installment's
 * within a cent per installment (banks put the rounding on different installments), and whose date
 * is within the plan's schedule give or take two months (some banks date every installment on the
 * purchase day). When two plans fit, the purchase name in the description must pick one; when it
 * cannot, the row is left for the user to link. A row a member unlinked from a plan by hand is never
 * linked to that plan again (`Transaction.installmentUnlinkedPlanKey`).
 *
 * `tenantKey` is explicit, so the same code runs in a request and in the sync worker.
 */
export async function linkPostedInstallments(em: EntityManager, input: { accountKeys?: number[]; planKeys?: number[]; tenantKey: number }): Promise<number> {
  const plans = await em.find(
    InstallmentPlan,
    {
      deletedAt: null,
      tenantKey: { tenantKey: input.tenantKey },
      ...(input.planKeys ? { installmentPlanKey: { $in: input.planKeys } } : {}),
      ...(input.accountKeys ? { accountKey: { accountKey: { $in: input.accountKeys } } } : {}),
    },
  );
  if (plans.length === 0) return 0;

  const planKeys = plans.map((plan) => plan.installmentPlanKey);
  const [schedule, posted] = await Promise.all([
    em.find(Installment, { deletedAt: null, installmentPlanKey: { installmentPlanKey: { $in: planKeys } } }),
    em.find(Transaction, { deletedAt: null, installmentPlanKey: { installmentPlanKey: { $in: planKeys } } }, { fields: ['installmentNumber', 'installmentPlanKey'], filters: { [HIDDEN_FILTER]: false } }),
  ]);
  const taken = new Set(posted.map((row) => `${row.installmentPlanKey?.installmentPlanKey}:${row.installmentNumber}`));
  const rowsByPlan = new Map<number, Map<number, Installment>>();
  for (const row of schedule) {
    const key = row.installmentPlanKey.installmentPlanKey;
    const map = rowsByPlan.get(key) ?? new Map<number, Installment>();
    map.set(row.installmentNumber, row);
    rowsByPlan.set(key, map);
  }

  const windowOf = (plan: InstallmentPlan) => {
    const dates = [...(rowsByPlan.get(plan.installmentPlanKey)?.values() ?? [])].map((row) => row.scheduledDate.getTime());
    return { from: Math.min(plan.purchaseDate.getTime(), ...dates) - MATCH_MARGIN_DAYS * DAY_MS, to: Math.max(plan.purchaseDate.getTime(), ...dates) + (MATCH_MARGIN_DAYS + 1) * DAY_MS };
  };
  const windows = new Map(plans.map((plan) => [plan.installmentPlanKey, windowOf(plan)]));
  const accountKeys = [...new Set(plans.map((plan) => plan.accountKey.accountKey))];
  const earliest = Math.min(...[...windows.values()].map((window) => window.from));

  const candidates = await em.find(
    Transaction,
    {
      accountKey: { accountKey: { $in: accountKeys } },
      deletedAt: null,
      installmentPlanKey: null,
      settlementAmount: { $lt: 0 },
      transactionDate: { $gte: new Date(earliest) },
    },
    { filters: { [HIDDEN_FILTER]: false }, orderBy: { transactionDate: 'asc', transactionKey: 'asc' }, populate: ['transactionStatusKey'] },
  );

  let linked = 0;
  for (const candidate of candidates) {
    if (candidate.transactionStatusKey?.name === EXPIRED_TRANSACTION_STATUS) continue;
    const marker = parseInstallmentMarker(candidate.description);
    if (!marker || !candidate.transactionDate) continue;
    const amountCents = Math.round(Math.abs(toNumber(candidate.settlementAmount)) * 100);
    const time = candidate.transactionDate.getTime();
    const fitting = plans.filter((plan) => {
      if (plan.accountKey.accountKey !== candidate.accountKey?.accountKey) return false;
      if (candidate.installmentUnlinkedPlanKey?.installmentPlanKey === plan.installmentPlanKey) return false;
      if (plan.installmentCount !== marker.installmentCount) return false;
      if (taken.has(`${plan.installmentPlanKey}:${marker.installmentNumber}`)) return false;
      const row = rowsByPlan.get(plan.installmentPlanKey)?.get(marker.installmentNumber);
      if (!row) return false;
      if (Math.abs(Math.round(toNumber(row.amount) * 100) - amountCents) > plan.installmentCount) return false;
      const window = windows.get(plan.installmentPlanKey);
      return window !== undefined && time >= window.from && time < window.to;
    });
    const stem = normalizeInstallmentStem(marker.stem);
    const chosen = fitting.length > 1 && stem
      ? fitting.filter((plan) => {
          const name = normalizeInstallmentStem(plan.description);
          return name.length > 0 && (name.includes(stem) || stem.includes(name));
        })
      : fitting;
    const plan = chosen.length === 1 ? chosen[0] : undefined;
    if (!plan) continue;
    candidate.installmentPlanKey = plan;
    candidate.installmentNumber = marker.installmentNumber;
    taken.add(`${plan.installmentPlanKey}:${marker.installmentNumber}`);
    linked += 1;
  }
  if (linked > 0) await em.flush();
  return linked;
}

/** Plans of the given accounts with installments still to come, for the forecast and the calendar. */
export async function loadUpcomingInstallments(em: EntityManager, input: { accountKeys?: number[]; from: Date; tenantKey: number; to: Date }) {
  const plans = await em.find(
    InstallmentPlan,
    {
      accountKey: { deletedAt: null, ...(input.accountKeys ? { accountKey: { $in: input.accountKeys } } : {}) },
      deletedAt: null,
      tenantKey: { tenantKey: input.tenantKey },
    },
    { populate: PLAN_POPULATE },
  );
  if (plans.length === 0) return [];
  const planKeys = plans.map((plan) => plan.installmentPlanKey);
  const [schedule, posted] = await Promise.all([
    em.find(Installment, {
      deletedAt: null,
      installmentPlanKey: { installmentPlanKey: { $in: planKeys } },
      scheduledDate: { $gte: toCalendarDate(input.from), $lte: toCalendarDate(input.to) },
    }, { orderBy: { installmentNumber: 'asc', scheduledDate: 'asc' } }),
    loadPostedRows(em, planKeys),
  ]);
  const planByKey = new Map(plans.map((plan) => [plan.installmentPlanKey, plan]));
  return schedule.flatMap((row) => {
    const plan = planByKey.get(row.installmentPlanKey.installmentPlanKey);
    if (!plan) return [];
    const paid = (posted.get(plan.installmentPlanKey) ?? []).some((postedRow) => postedRow.installmentNumber === row.installmentNumber);
    return [{
      accountKey: plan.accountKey.accountKey,
      amount: toNumber(row.amount),
      currency: plan.accountKey.currencyKey.code,
      date: row.scheduledDate,
      installmentCount: plan.installmentCount,
      installmentNumber: row.installmentNumber,
      installmentPlanKey: plan.installmentPlanKey,
      name: plan.description,
      paid,
    }];
  });
}

import type { FilterQuery } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

import { Appuser } from '@entity/Appuser';
import { Currency } from '@entity/Currency';
import { Loan } from '@entity/Loan';
import { ManualAsset } from '@entity/ManualAsset';
import { ManualAssetValuation } from '@entity/ManualAssetValuation';
import { Tenant } from '@entity/Tenant';
import { type CurrencyPair, loadRateTable, type RateScope, rateScope, type RateTable } from '@service/currency/exchange-rate';
import { outstandingPrincipalsOn } from '@service/loan/loan-balance';
import { getRef } from '@utils/em-helpers';
import { BadRequestError, ConflictError, ERROR_CODE, ForbiddenError, NotFoundError } from '@utils/errors';
import { Money } from '@utils/money';

import type { ManualAssetKind } from './manual-asset-types';
import { type AssetValueSeriesPoint, buildValueSeries, latestValuationOn, type ValuedAsset, valueOn } from './manual-asset-valuation';

/**
 * Manually valued assets: the household's homes, vehicles and valuables.
 *
 * Every read and write carries the tenant and the privacy rule explicitly (`visibleAssetsWhere`),
 * on top of the request's tenant filter, so the scope also holds where no filter is armed (the
 * worker). A private asset exists only for its owner: to the other member it is a 404, and it is
 * in none of their totals.
 *
 * An asset's value is in its own currency. For a viewer it is converted at the latest rate on or
 * before the day; with no rate it has no converted value and is left out of totals and counted,
 * never added at face value.
 *
 * A loan can be secured against an asset (`Loan.securedAssetKey`). The asset then shows the
 * viewer's loans on it and its equity: today's value less their outstanding principal, both in
 * the asset's currency. Loans are personal, so only the viewer's own count. The link is
 * presentation only; net worth counts the asset and the loans exactly as without it.
 */

export interface AssetViewer {
  appuserKey: number;
  /** The currency the viewer reads totals in. */
  currencyCode: string;
  tenantKey: number;
}

export interface CreateManualAssetInput {
  currencyKey: number;
  growthRule?: GrowthRuleInput | null;
  isPrivate?: boolean;
  kind: ManualAssetKind;
  name: string;
  notes?: null | string;
  purchaseDate?: Date | null;
  purchasePrice?: null | number;
  valuationDate?: Date;
  value: number;
}

export interface GrowthRuleInput {
  annualRatePercent: number;
  startDate?: Date | null;
}

/** An asset with the valuations that give it a value. */
export interface LoadedManualAsset {
  asset: ManualAsset;
  valuations: ManualAssetValuation[];
}

/** One of the viewer's loans secured against an asset, with today's outstanding principal. */
export interface LinkedLoanDto {
  /** The loan's currency. */
  currency: string;
  loanKey: number;
  name: string;
  /** In the loan's currency. */
  outstandingPrincipal: number;
  /** In the asset's currency, at the latest rate. Null when no rate converts it. */
  outstandingPrincipalInAssetCurrency: null | number;
}

export interface ManualAssetDto {
  archived: boolean;
  archivedAt: null | string;
  createdAt: string;
  /** The currency the asset is valued in. */
  currency: string;
  currencyKey: number;
  /**
   * `value` less `linkedDebt`, in `currency`. Null when the asset has no value today (archived) or
   * a linked loan cannot be converted: it is never worked out from amounts in two currencies.
   */
  equity: null | number;
  growthRule: null | { annualRatePercent: number; startDate: null | string };
  /** The viewer owns the asset: only they may change `isPrivate`. */
  isOwner: boolean;
  isPrivate: boolean;
  kind: ManualAssetKind;
  /** The latest valuation recorded, before any growth rule. */
  lastValuation: ManualAssetValuationDto | null;
  /** The total outstanding principal of `linkedLoans` in `currency`; 0 with none, null when one has no rate. */
  linkedDebt: null | number;
  /** The viewer's loans secured against the asset. */
  linkedLoans: LinkedLoanDto[];
  manualAssetKey: number;
  name: string;
  notes: null | string;
  ownerAppuserKey: number;
  ownerFirstName: null | string;
  purchaseDate: null | string;
  purchasePrice: null | number;
  /** The currencies of linked loans no rate converts into `currency`. */
  unconvertedLoanCurrencies: string[];
  updatedAt: string;
  userCurrency: string;
  /** Today's value in `currency`. Null for an archived asset. */
  value: null | number;
  /** `value` in `userCurrency`. Null when there is no value or no exchange rate. */
  valueInUserCurrency: null | number;
}

export interface ManualAssetsSummary {
  currencyCode: string;
  /** False when an asset was left out of `totalValue` because no rate converts it. */
  isComplete: boolean;
  /** The assets that count today, in `currencyCode`. */
  totalValue: number;
  unconvertedAssets: number;
  unconvertedCurrencies: string[];
}

export interface ManualAssetValuationDto {
  date: string;
  manualAssetValuationKey: number;
  note: null | string;
  value: number;
}

export interface UpdateManualAssetInput {
  archived?: boolean;
  growthRule?: GrowthRuleInput | null;
  isPrivate?: boolean;
  kind?: ManualAssetKind;
  name?: string;
  notes?: null | string;
  purchaseDate?: Date | null;
  purchasePrice?: null | number;
}

/** An asset's value for a viewer on a date: in its own currency and, when a rate exists, in theirs. */
export interface ViewerAssetValue {
  currencyCode: string;
  value: number;
  valueInViewerCurrency: null | number;
}

const DAY_MS = 86_400_000;
const ASSET_POPULATE = ['currencyKey', 'ownerAppuserKey'] as const;

export async function addValuation(em: EntityManager, viewer: AssetViewer, manualAssetKey: number, input: { date?: Date; note?: null | string; value: number }, now = new Date()) {
  const loaded = await loadAssetOrThrow(em, viewer, manualAssetKey);
  const date = input.date ?? utcDayOf(now);
  // One valuation a day: a second one for the same day corrects the first.
  const sameDay = loaded.valuations.find((valuation) => sameUtcDay(valuation.valuationDate, date));
  let valuation: ManualAssetValuation;
  if (sameDay) {
    sameDay.value = input.value;
    if (input.note !== undefined) sameDay.note = input.note;
    valuation = sameDay;
  } else {
    valuation = newValuation(em, loaded.asset, date, input.value, input.note);
    loaded.valuations.push(valuation);
  }
  await em.flush();
  return { asset: await describeAsset(em, viewer, loaded, now), replaced: sameDay != null, valuation: toValuationDto(valuation) };
}

/**
 * The asset's value on `valueDate` for a viewer, or null when it has none then (no valuation yet,
 * archived). It is converted at the latest rate on or before `rateDate`.
 */
export function assetValueFor(loaded: LoadedManualAsset, viewerCurrency: string, rates: RateTable, on: { rateDate: Date; valueDate: Date }): null | ViewerAssetValue {
  const value = valueOn(toValuedAsset(loaded), on.valueDate);
  if (value == null) return null;
  const currencyCode = loaded.asset.currencyKey.code;
  const rate = rates.rateOn(currencyCode, viewerCurrency, on.rateDate);
  return {
    currencyCode,
    value,
    valueInViewerCurrency: rate == null ? null : Money.toNumber(Money.convert(Money.of(value, currencyCode), { rate, to: viewerCurrency })),
  };
}

/** The asset's value today for a viewer, at the latest rate. */
export async function createManualAsset(em: EntityManager, viewer: AssetViewer, input: CreateManualAssetInput, now = new Date()): Promise<ManualAssetDto> {
  const currency = await em.findOne(Currency, { currencyKey: input.currencyKey });
  if (!currency) throw new BadRequestError('Currency not found');

  const asset = new ManualAsset();
  asset.currencyKey = currency;
  asset.growthAnnualRatePercent = input.growthRule?.annualRatePercent ?? null;
  asset.growthStartDate = input.growthRule?.startDate ?? null;
  asset.isPrivate = input.isPrivate ?? false;
  asset.kind = input.kind;
  asset.name = input.name;
  asset.notes = input.notes ?? null;
  asset.ownerAppuserKey = await em.findOneOrFail(Appuser, { appuserKey: viewer.appuserKey });
  asset.purchaseDate = input.purchaseDate ?? null;
  asset.purchasePrice = input.purchasePrice ?? null;
  asset.tenantKey = getRef(em, Tenant, viewer.tenantKey);
  em.persist(asset);

  const valuationDate = input.valuationDate ?? utcDayOf(now);
  const valuations = [newValuation(em, asset, valuationDate, input.value)];
  // The purchase is the asset's first known value, so its history starts there and not at today.
  if (input.purchaseDate && input.purchasePrice != null && utcDayOf(input.purchaseDate).getTime() < utcDayOf(valuationDate).getTime()) {
    valuations.push(newValuation(em, asset, input.purchaseDate, input.purchasePrice));
  }
  await em.flush();
  return describeAsset(em, viewer, { asset, valuations }, now);
}

export function currentAssetValueFor(loaded: LoadedManualAsset, viewerCurrency: string, rates: RateTable, now: Date): null | ViewerAssetValue {
  return assetValueFor(loaded, viewerCurrency, rates, { rateDate: now, valueDate: currentValueDate(loaded, now) });
}

/**
 * The date today's value is read on: today (UTC), or tomorrow when a valuation is already dated
 * tomorrow, which is "today" for a user east of UTC.
 */
export function currentValueDate(loaded: LoadedManualAsset, now: Date): Date {
  const today = utcDayOf(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  return loaded.valuations.some((valuation) => sameUtcDay(valuation.valuationDate, tomorrow)) ? tomorrow : today;
}

export async function deleteManualAsset(em: EntityManager, viewer: AssetViewer, manualAssetKey: number): Promise<void> {
  const { asset, valuations } = await loadAssetOrThrow(em, viewer, manualAssetKey);
  const deletedAt = new Date();
  asset.deletedAt = deletedAt;
  for (const valuation of valuations) valuation.deletedAt = deletedAt;
  // Every member's loans on it lose the link and stay as they are.
  const securedLoans = await em.find(Loan, { securedAssetKey: asset, tenantKey: { tenantKey: viewer.tenantKey } });
  for (const loan of securedLoans) loan.securedAssetKey = null;
  await em.flush();
}

export async function deleteValuation(em: EntityManager, viewer: AssetViewer, manualAssetKey: number, valuationKey: number): Promise<void> {
  const loaded = await loadAssetOrThrow(em, viewer, manualAssetKey);
  const valuation = findValuationOrThrow(loaded, valuationKey);
  // An asset with no valuation has no value at all; delete the asset instead.
  if (loaded.valuations.length === 1) throw new ConflictError('An asset keeps at least one valuation', ERROR_CODE.MANUAL_ASSET_LAST_VALUATION);
  valuation.deletedAt = new Date();
  await em.flush();
}

export async function getManualAsset(em: EntityManager, viewer: AssetViewer, manualAssetKey: number, now = new Date()): Promise<{ asset: ManualAssetDto; history: AssetValueSeriesPoint[]; valuations: ManualAssetValuationDto[] }> {
  const loaded = await loadAssetOrThrow(em, viewer, manualAssetKey);
  return {
    asset: await describeAsset(em, viewer, loaded, now),
    history: buildValueSeries(toValuedAsset(loaded), currentValueDate(loaded, now)),
    valuations: sortedValuationDtos(loaded),
  };
}

export async function listManualAssets(em: EntityManager, viewer: AssetViewer, now = new Date()): Promise<{ assets: ManualAssetDto[]; summary: ManualAssetsSummary }> {
  const loaded = await loadVisibleManualAssets(em, viewer);
  const [rates, linkedLoans] = await Promise.all([
    loadAssetRates(em, loaded, viewer.currencyCode, { from: now, to: now }, rateScope(viewer.tenantKey)),
    loadLinkedLoans(em, viewer, loaded, now),
  ]);
  const assets = loaded.map((item) => toAssetDto(item, viewer, rates, now, linkedLoans.get(item.asset.manualAssetKey) ?? []));

  const counted = assets.filter((asset) => asset.value != null);
  const unconverted = counted.filter((asset) => asset.valueInUserCurrency == null);
  return {
    assets,
    summary: {
      currencyCode: viewer.currencyCode,
      isComplete: unconverted.length === 0,
      totalValue: Money.toNumber(Money.sum(counted.flatMap((asset) => (asset.valueInUserCurrency == null ? [] : [Money.of(asset.valueInUserCurrency, viewer.currencyCode)])), viewer.currencyCode)),
      unconvertedAssets: unconverted.length,
      unconvertedCurrencies: [...new Set(unconverted.map((asset) => asset.currency))].sort(),
    },
  };
}

export async function listValuations(em: EntityManager, viewer: AssetViewer, manualAssetKey: number): Promise<ManualAssetValuationDto[]> {
  return sortedValuationDtos(await loadAssetOrThrow(em, viewer, manualAssetKey));
}

/** The rates that convert these assets into `viewerCurrency` over `window`: the feed's and the household's overrides (`scope`). */
export async function loadAssetRates(em: EntityManager, assets: LoadedManualAsset[], viewerCurrency: string, window: { from: Date; to: Date }, scope: RateScope): Promise<RateTable> {
  return loadRateTable(em, manualAssetRatePairs(assets, viewerCurrency), window, scope);
}

/**
 * The viewer's live loans secured against each of these assets, keyed by asset, with today's
 * outstanding principal converted into the asset's currency at the latest rate on or before
 * `now` (the household's overrides included).
 */
export async function loadLinkedLoans(em: EntityManager, viewer: Pick<AssetViewer, 'appuserKey' | 'tenantKey'>, assets: LoadedManualAsset[], now: Date): Promise<Map<number, LinkedLoanDto[]>> {
  const byAsset = new Map<number, LinkedLoanDto[]>();
  if (assets.length === 0) return byAsset;
  const assetsByKey = new Map(assets.map(({ asset }) => [asset.manualAssetKey, asset]));
  const loans = await em.find(
    Loan,
    { deletedAt: undefined, ownerAppuserKey: { appuserKey: viewer.appuserKey }, securedAssetKey: { $in: assets.map(({ asset }) => asset) }, tenantKey: { tenantKey: viewer.tenantKey } },
    { orderBy: { loanKey: 'ASC' }, populate: ['currencyKey'] },
  );
  if (loans.length === 0) return byAsset;
  const pairs: CurrencyPair[] = loans.flatMap((loan) => {
    const asset = loan.securedAssetKey ? assetsByKey.get(loan.securedAssetKey.manualAssetKey) : undefined;
    return asset ? [{ from: loan.currencyKey.code, to: asset.currencyKey.code }] : [];
  });
  const [principals, rates] = await Promise.all([
    outstandingPrincipalsOn(em, loans, now),
    loadRateTable(em, pairs, { from: now, to: now }, rateScope(viewer.tenantKey)),
  ]);
  for (const loan of loans) {
    const asset = loan.securedAssetKey ? assetsByKey.get(loan.securedAssetKey.manualAssetKey) : undefined;
    if (!asset) continue;
    const outstandingPrincipal = principals.get(loan.loanKey) ?? 0;
    const rate = rates.rateOn(loan.currencyKey.code, asset.currencyKey.code, now);
    const linked: LinkedLoanDto = {
      currency: loan.currencyKey.code,
      loanKey: loan.loanKey,
      name: loan.name,
      outstandingPrincipal,
      outstandingPrincipalInAssetCurrency: rate == null ? null : Money.toNumber(Money.convert(Money.of(outstandingPrincipal, loan.currencyKey.code), { rate, to: asset.currencyKey.code })),
    };
    byAsset.set(asset.manualAssetKey, [...(byAsset.get(asset.manualAssetKey) ?? []), linked]);
  }
  return byAsset;
}

/**
 * The debt secured against an asset and its equity, in the asset's currency. A loan with no rate
 * leaves both unknown (and its currency named) rather than counting it at face value or not at all.
 */
export function securedEquity(value: null | number, currency: string, linkedLoans: readonly LinkedLoanDto[]): Pick<ManualAssetDto, 'equity' | 'linkedDebt' | 'unconvertedLoanCurrencies'> {
  const unconverted = linkedLoans.filter((loan) => loan.outstandingPrincipalInAssetCurrency == null);
  const unconvertedLoanCurrencies = [...new Set(unconverted.map((loan) => loan.currency))].sort();
  if (unconverted.length > 0) return { equity: null, linkedDebt: null, unconvertedLoanCurrencies };
  const debt = Money.sum(linkedLoans.map((loan) => Money.of(loan.outstandingPrincipalInAssetCurrency ?? 0, currency)), currency);
  return {
    equity: value == null ? null : Money.toNumber(Money.subtract(Money.of(value, currency), debt)),
    linkedDebt: Money.toNumber(debt),
    unconvertedLoanCurrencies,
  };
}

/** Every live asset the viewer may see, with its live valuations: the household's shared ones and their own private ones. */
export async function loadVisibleManualAssets(em: EntityManager, viewer: Pick<AssetViewer, 'appuserKey' | 'tenantKey'>, where: FilterQuery<ManualAsset> = {}): Promise<LoadedManualAsset[]> {
  const assets = await em.find(ManualAsset, { $and: [visibleAssetsWhere(viewer), where] }, { orderBy: { manualAssetKey: 'ASC' }, populate: ASSET_POPULATE });
  if (assets.length === 0) return [];
  const valuations = await em.find(
    ManualAssetValuation,
    { deletedAt: undefined, manualAssetKey: { $in: assets }, tenantKey: { tenantKey: viewer.tenantKey } },
    { orderBy: { manualAssetValuationKey: 'ASC' } },
  );
  const byAsset = new Map<number, ManualAssetValuation[]>();
  for (const valuation of valuations) {
    const key = valuation.manualAssetKey.manualAssetKey;
    byAsset.set(key, [...(byAsset.get(key) ?? []), valuation]);
  }
  return assets.map((asset) => ({ asset, valuations: byAsset.get(asset.manualAssetKey) ?? [] }));
}

export function manualAssetRatePairs(assets: LoadedManualAsset[], viewerCurrency: string): CurrencyPair[] {
  return assets.map(({ asset }) => ({ from: asset.currencyKey.code, to: viewerCurrency }));
}

export function toValuedAsset({ asset, valuations }: LoadedManualAsset): ValuedAsset {
  return {
    archivedAt: asset.archivedAt,
    growthRule: asset.growthAnnualRatePercent == null ? null : { annualRatePercent: asset.growthAnnualRatePercent, startDate: asset.growthStartDate ? new Date(asset.growthStartDate) : null },
    valuations: valuations.map((valuation) => ({ date: new Date(valuation.valuationDate), key: valuation.manualAssetValuationKey, value: valuation.value })),
  };
}

export async function updateManualAsset(em: EntityManager, viewer: AssetViewer, manualAssetKey: number, input: UpdateManualAssetInput, now = new Date()): Promise<ManualAssetDto> {
  const loaded = await loadAssetOrThrow(em, viewer, manualAssetKey);
  const { asset } = loaded;
  if (input.isPrivate !== undefined && input.isPrivate !== asset.isPrivate) {
    // Only the owner decides whether the other member sees the asset.
    if (asset.ownerAppuserKey.appuserKey !== viewer.appuserKey) throw new ForbiddenError('Only the asset owner can change its privacy.', ERROR_CODE.MANUAL_ASSET_OWNER_REQUIRED);
    asset.isPrivate = input.isPrivate;
  }
  if (input.name !== undefined) asset.name = input.name;
  if (input.kind !== undefined) asset.kind = input.kind;
  if (input.notes !== undefined) asset.notes = input.notes;
  if (input.purchaseDate !== undefined) asset.purchaseDate = input.purchaseDate;
  if (input.purchasePrice !== undefined) asset.purchasePrice = input.purchasePrice;
  if (input.growthRule !== undefined) {
    asset.growthAnnualRatePercent = input.growthRule?.annualRatePercent ?? null;
    asset.growthStartDate = input.growthRule?.startDate ?? null;
  }
  if (input.archived === true && !asset.archivedAt) asset.archivedAt = now;
  if (input.archived === false) asset.archivedAt = null;
  await em.flush();
  return describeAsset(em, viewer, loaded, now);
}

export async function updateValuation(em: EntityManager, viewer: AssetViewer, manualAssetKey: number, valuationKey: number, input: { date?: Date; note?: null | string; value?: number }, now = new Date()) {
  const loaded = await loadAssetOrThrow(em, viewer, manualAssetKey);
  const valuation = findValuationOrThrow(loaded, valuationKey);
  const { date } = input;
  if (date !== undefined) {
    const taken = loaded.valuations.some((other) => other !== valuation && sameUtcDay(other.valuationDate, date));
    if (taken) throw new ConflictError('The asset already has a valuation on that date');
    valuation.valuationDate = date;
  }
  if (input.value !== undefined) valuation.value = input.value;
  if (input.note !== undefined) valuation.note = input.note;
  await em.flush();
  return { asset: await describeAsset(em, viewer, loaded, now), valuation: toValuationDto(valuation) };
}

/** Tenant and privacy as explicit criteria: shared assets of the household, and the viewer's own private ones. */
export function visibleAssetsWhere(viewer: Pick<AssetViewer, 'appuserKey' | 'tenantKey'>): FilterQuery<ManualAsset> {
  return { $or: [{ isPrivate: false }, { ownerAppuserKey: { appuserKey: viewer.appuserKey } }], deletedAt: undefined, tenantKey: { tenantKey: viewer.tenantKey } };
}

async function describeAsset(em: EntityManager, viewer: AssetViewer, loaded: LoadedManualAsset, now: Date): Promise<ManualAssetDto> {
  const [rates, linkedLoans] = await Promise.all([
    loadAssetRates(em, [loaded], viewer.currencyCode, { from: now, to: now }, rateScope(viewer.tenantKey)),
    loadLinkedLoans(em, viewer, [loaded], now),
  ]);
  return toAssetDto(loaded, viewer, rates, now, linkedLoans.get(loaded.asset.manualAssetKey) ?? []);
}

function findValuationOrThrow(loaded: LoadedManualAsset, valuationKey: number): ManualAssetValuation {
  // Looked up among the asset's own valuations, so a key from another asset or household is not found.
  const valuation = loaded.valuations.find((item) => item.manualAssetValuationKey === valuationKey);
  if (!valuation) throw new NotFoundError('Valuation not found');
  return valuation;
}

const isoDay = (date: Date | string) => new Date(date).toISOString().slice(0, 10);

async function loadAssetOrThrow(em: EntityManager, viewer: AssetViewer, manualAssetKey: number): Promise<LoadedManualAsset> {
  const [loaded] = await loadVisibleManualAssets(em, viewer, { manualAssetKey });
  if (!loaded) throw new NotFoundError('Asset not found');
  return loaded;
}

function newValuation(em: EntityManager, asset: ManualAsset, date: Date, value: number, note?: null | string): ManualAssetValuation {
  const valuation = new ManualAssetValuation();
  valuation.manualAssetKey = asset;
  valuation.note = note ?? null;
  valuation.tenantKey = asset.tenantKey;
  valuation.valuationDate = utcDayOf(date);
  valuation.value = value;
  em.persist(valuation);
  return valuation;
}

function sameUtcDay(a: Date | string, b: Date | string): boolean {
  return utcDayOf(new Date(a)).getTime() === utcDayOf(new Date(b)).getTime();
}

/** Newest first. */
function sortedValuationDtos(loaded: LoadedManualAsset): ManualAssetValuationDto[] {
  return loaded.valuations
    .map(toValuationDto)
    .sort((a, b) => b.date.localeCompare(a.date) || b.manualAssetValuationKey - a.manualAssetValuationKey);
}

function toAssetDto(loaded: LoadedManualAsset, viewer: AssetViewer, rates: RateTable, now: Date, linkedLoans: LinkedLoanDto[]): ManualAssetDto {
  const { asset } = loaded;
  const asOf = currentValueDate(loaded, now);
  const current = currentAssetValueFor(loaded, viewer.currencyCode, rates, now);
  const latest = latestValuationOn(loaded.valuations.map((valuation) => ({ date: new Date(valuation.valuationDate), key: valuation.manualAssetValuationKey, valuation, value: valuation.value })), asOf);
  return {
    archived: asset.archivedAt != null,
    archivedAt: asset.archivedAt ? new Date(asset.archivedAt).toISOString() : null,
    createdAt: asset.createdAt.toISOString(),
    currency: asset.currencyKey.code,
    currencyKey: asset.currencyKey.currencyKey,
    ...securedEquity(current?.value ?? null, asset.currencyKey.code, linkedLoans),
    growthRule: asset.growthAnnualRatePercent == null ? null : { annualRatePercent: asset.growthAnnualRatePercent, startDate: asset.growthStartDate ? isoDay(asset.growthStartDate) : null },
    isOwner: asset.ownerAppuserKey.appuserKey === viewer.appuserKey,
    isPrivate: asset.isPrivate,
    kind: asset.kind,
    lastValuation: latest ? toValuationDto(latest.valuation) : null,
    linkedLoans,
    manualAssetKey: asset.manualAssetKey,
    name: asset.name,
    notes: asset.notes ?? null,
    ownerAppuserKey: asset.ownerAppuserKey.appuserKey,
    ownerFirstName: asset.ownerAppuserKey.firstName ?? null,
    purchaseDate: asset.purchaseDate ? isoDay(asset.purchaseDate) : null,
    purchasePrice: asset.purchasePrice ?? null,
    updatedAt: asset.updatedAt.toISOString(),
    userCurrency: viewer.currencyCode,
    value: current?.value ?? null,
    valueInUserCurrency: current?.valueInViewerCurrency ?? null,
  };
}

function toValuationDto(valuation: ManualAssetValuation): ManualAssetValuationDto {
  return { date: isoDay(valuation.valuationDate), manualAssetValuationKey: valuation.manualAssetValuationKey, note: valuation.note ?? null, value: valuation.value };
}

function utcDayOf(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

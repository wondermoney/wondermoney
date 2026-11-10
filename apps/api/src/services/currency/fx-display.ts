import type { EntityManager } from '@mikro-orm/core';

import type { Currency } from '@entity/Currency';
import { FxStatus } from '@entity/Transaction';
import { resolveExchangeRate } from '@service/currency/exchange-rate';

/**
 * How an amount shown in the user's currency was converted, for clients to say so: `missing`
 * has no converted amount (show the original), `provisional` was converted at an old rate,
 * dated `fxRateDate` (`YYYY-MM-DD`). Null `fxStatus` is a legacy row with an amount but no status.
 */
export interface FxDisplay {
  fxRateDate: null | string;
  fxStatus: FxStatus | null;
}

/** No conversion information: a legacy row. */
export const UNKNOWN_FX: FxDisplay = Object.freeze({ fxRateDate: null, fxStatus: null });

/** One converted amount: from `from` into `to`, at the rate for `date`. */
export interface FxSubject {
  /** The converted amount, null when none is stored. */
  converted: null | number | undefined;
  date: Date;
  from: Currency | undefined;
  status: FxStatus | null | undefined;
  to: Currency | undefined;
}

/**
 * Describe how each subject was converted. A provisional one gets the date of the rate the one
 * resolver picks for it today (`resolveExchangeRate`), looked up once per pair and day, so only
 * provisional rows cost a query.
 */
export async function describeFx(em: EntityManager, subjects: FxSubject[]): Promise<FxDisplay[]> {
  const statuses = subjects.map(effectiveStatus);
  const rateDates = new Map<string, Promise<null | string>>();
  return Promise.all(
    subjects.map(async (subject, index) => {
      const fxStatus = statuses[index] ?? null;
      if (fxStatus !== FxStatus.PROVISIONAL || !subject.from || !subject.to) return { fxRateDate: null, fxStatus };
      const { from, to } = subject;
      const key = `${from.currencyKey}>${to.currencyKey}@${isoDay(subject.date)}`;
      let rateDate = rateDates.get(key);
      if (!rateDate) {
        rateDate = resolveExchangeRate(em, from, to, subject.date).then((resolved) => (resolved ? isoDay(resolved.rateDate) : null));
        rateDates.set(key, rateDate);
      }
      return { fxRateDate: await rateDate, fxStatus };
    }),
  );
}

function effectiveStatus(subject: FxSubject): FxStatus | null {
  if (subject.from && subject.to && sameCurrency(subject.from, subject.to)) return FxStatus.EXACT;
  if (subject.status) return subject.status;
  // A row written before `fxStatus` existed, with no converted amount, was not converted.
  return subject.converted == null ? FxStatus.MISSING : null;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function sameCurrency(a: Currency, b: Currency): boolean {
  if (a.code && b.code) return a.code === b.code;
  return a.currencyKey === b.currencyKey;
}

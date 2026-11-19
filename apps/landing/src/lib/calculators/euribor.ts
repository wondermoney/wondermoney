/**
 * Euribor reference rates: the latest monthly average by tenor, its change on the month before,
 * the history for the chart, and what a change in the index does to a variable-rate mortgage
 * payment. The payment maths is `./rateRevision` (itself on the shared `./amortization` engine),
 * not repeated here.
 *
 * The data is Banco de Portugal's BPstat monthly averages (see `./data/euribor`): a monthly
 * average is not the rate fixed on any one day, and a loan resets on the contract's own fixing.
 */

import { EURIBOR_HISTORY, EURIBOR_SOURCE, type EuriborRow } from "./data/euribor";
import {
	RATE_REVISION_LIMITS,
	computeRateRevision,
	type RateRevisionResult,
} from "./rateRevision";

export { EURIBOR_HISTORY, EURIBOR_SOURCE };

export const EURIBOR_TENORS = [3, 6, 12] as const;
export type EuriborTenor = (typeof EURIBOR_TENORS)[number];

export const EURIBOR_LIMITS = {
	/** Points. The largest change the calculator accepts, either way. */
	maxChange: 5,
	maxSpread: RATE_REVISION_LIMITS.maxSpread,
	minBalance: RATE_REVISION_LIMITS.minBalance,
	maxBalance: RATE_REVISION_LIMITS.maxBalance,
	maxTermYears: RATE_REVISION_LIMITS.maxTermYears,
} as const;

export type EuriborInput = {
	balance: number
	termYears: number
	termMonths: number
	/** The lender's margin, in percent. */
	spread: number
	tenor: EuriborTenor
	/** Change in the index, in points; negative for a fall. Empty (NaN) is `required`. */
	change: number
}

export const EURIBOR_EXAMPLE: EuriborInput = {
	balance: 150_000,
	termYears: 25,
	termMonths: 0,
	spread: 1,
	tenor: 12,
	change: 1,
};

const index = (tenor: EuriborTenor) => (tenor === 3 ? 1 : tenor === 6 ? 2 : 3);
const rateOf = (row: EuriborRow, tenor: EuriborTenor) => row[index(tenor)] as number;
const round = (value: number, decimals: number) => Number(value.toFixed(decimals));

export type EuriborCurrent = {
	tenor: EuriborTenor;
	/** Monthly average of the latest month, percent, 2 decimals. */
	rate: number;
	/** The month before, percent, 2 decimals. */
	previousRate: number;
	/** Rate minus the previous month's, in points (from the unrounded averages), 2 decimals. */
	change: number;
}

export type EuriborLatest = {
	/** YYYY-MM of the latest monthly average. */
	month: string;
	previousMonth: string;
	rates: EuriborCurrent[];
}

/** The latest month by tenor, with the change on the month before. */
export function getLatestEuribor(history: readonly EuriborRow[] = EURIBOR_HISTORY): EuriborLatest {
	if (history.length < 2) throw new Error("Euribor history needs at least two months");
	const last = history[history.length - 1];
	const previous = history[history.length - 2];
	return {
		month: last[0],
		previousMonth: previous[0],
		rates: EURIBOR_TENORS.map((tenor) => ({
			tenor,
			rate: round(rateOf(last, tenor), 2),
			previousRate: round(rateOf(previous, tenor), 2) + 0,
			change: round(rateOf(last, tenor) - rateOf(previous, tenor), 2) + 0,
		})),
	};
}

export type EuriborPoint = { month: string; m3: number; m6: number; m12: number }

/** History from `fromYear` (January) to the latest month, rates to 2 decimals. */
export function getEuriborSeries(
	fromYear: number,
	history: readonly EuriborRow[] = EURIBOR_HISTORY,
): EuriborPoint[] {
	return history
		.filter(([month]) => Number(month.slice(0, 4)) >= fromYear)
		.map(([month, m3, m6, m12]) => ({ month, m3: round(m3, 2), m6: round(m6, 2), m12: round(m12, 2) }));
}

export type EuriborField = "balance" | "termYears" | "termMonths" | "spread" | "change";
export type EuriborError = "required" | "tooSmall" | "tooLarge" | "negative";

export type EuriborImpact = {
	/** The index before the change: the tenor's latest monthly average, 2 decimals, percent. */
	indexRate: number;
	newIndexRate: number;
	revision: RateRevisionResult;
};

export type EuriborCalculation =
	| { ok: true; result: EuriborImpact }
	| { ok: false; errors: Partial<Record<EuriborField, EuriborError>> };

/**
 * The payment today and after `change` points on the tenor's latest monthly average, with the
 * lender's spread, over the time left. Rate floors and the payment come from `computeRateRevision`.
 */
export function computeEuriborImpact(
	input: EuriborInput,
	latest: EuriborLatest = getLatestEuribor(),
): EuriborCalculation {
	const current = latest.rates.find((entry) => entry.tenor === input.tenor);
	if (!current) throw new Error(`Unknown tenor ${input.tenor}`);

	const errors: Partial<Record<EuriborField, EuriborError>> = {};
	if (Number.isNaN(input.change)) errors.change = "required";
	else if (input.change < -EURIBOR_LIMITS.maxChange) errors.change = "tooSmall";
	else if (input.change > EURIBOR_LIMITS.maxChange) errors.change = "tooLarge";

	const indexRate = current.rate;
	const newIndexRate = Number.isNaN(input.change) ? Number.NaN : round(indexRate + input.change, 4);
	const calculation = computeRateRevision({
		balance: input.balance,
		termYears: input.termYears,
		termMonths: input.termMonths,
		indexRate,
		spread: input.spread,
		newIndexRate,
		monthlyIncome: Number.NaN,
	});
	if (!calculation.ok) {
		const { balance, termYears, termMonths, spread } = calculation.errors;
		for (const [field, error] of Object.entries({ balance, termYears, termMonths, spread })) {
			if (error) errors[field as EuriborField] = error;
		}
	}
	if (Object.keys(errors).length > 0 || !calculation.ok) return { ok: false, errors };
	return { ok: true, result: { indexRate, newIndexRate, revision: calculation.result } };
}

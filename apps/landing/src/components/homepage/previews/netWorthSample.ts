/**
 * Sample data for the net worth preview, the card on the homepage hero and on the net worth
 * feature page. It is a marketing mockup, not the live app, and the figures are illustrative.
 *
 * Each sample is one household: every account row holds its balance at the start and at the end
 * of the period, so the totals, the change badges and the chart all derive from the same numbers.
 * `netWorthSample.test.ts` checks that the history's first and last points are the rows' sums.
 */

export type NetWorthRowKind = "asset" | "liability";

export interface NetWorthRow {
	/** Translation key of the row's label. */
	labelKey: string;
	kind: NetWorthRowKind;
	/**
	 * The example institution whose logo the row shows, by its name in `src/lib/brandLogos/`: only
	 * institutions the product supports (`InstitutionMarks.tsx`), as examples, never as partners.
	 */
	institution: string;
	/** Balance at the first month of the history, in euros. A liability is the amount owed. */
	start: number;
	/** Balance at the last month of the history, in euros. */
	end: number;
}

export interface NetWorthSample {
	/** Month-end net worth, one point per month in `months`, oldest first. */
	history: number[];
	/** First day of each month in `history`, fixed so a static build stays deterministic. */
	months: Date[];
	/** The chart's y-axis ticks, low to high; the first and last bound the plot. */
	yTicks: number[];
	rows: NetWorthRow[];
}

const monthsFrom = (year: number, firstMonth: number, count: number) =>
	Array.from({ length: count }, (_, i) => new Date(Date.UTC(year, firstMonth + i, 1)));

/** The homepage hero: a younger household, everyday accounts, investments and a credit card. */
export const HERO_NET_WORTH: NetWorthSample = {
	history: [49980, 50720, 50410, 51630, 52580, 53630],
	months: monthsFrom(2026, 2, 6), // March to August 2026
	yTicks: [48000, 51000, 54000],
	rows: [
		{ labelKey: "preview.netWorth.bankAccounts", institution: "CGD", kind: "asset", start: 21200, end: 22020 },
		{ labelKey: "preview.netWorth.investments", institution: "DEGIRO", kind: "asset", start: 29620, end: 32150 },
		{ labelKey: "preview.netWorth.creditCard", institution: "BPI", kind: "liability", start: 840, end: 540 },
	],
};

/** The net worth feature page: a household with a mortgage, a car loan and a card. */
export const FEATURE_NET_WORTH: NetWorthSample = {
	history: [148200, 151800, 156400, 155300, 161700, 164500],
	months: monthsFrom(2026, 4, 6), // May to October 2026
	yTicks: [145000, 155000, 165000],
	rows: [
		{ labelKey: "preview.netWorth.bankAccounts", institution: "ActivoBank", kind: "asset", start: 43900, end: 45200 },
		{ labelKey: "preview.netWorth.investments", institution: "Interactive Brokers", kind: "asset", start: 190400, end: 202800 },
		{ labelKey: "preview.netWorth.mortgage", institution: "CGD", kind: "liability", start: 73400, end: 71200 },
		{ labelKey: "preview.netWorth.carLoan", institution: "BPI", kind: "liability", start: 9100, end: 8200 },
		{ labelKey: "preview.netWorth.creditCard", institution: "novobanco", kind: "liability", start: 3600, end: 4100 },
	],
};

export interface Change {
	/** Absolute change in euros, end minus start. */
	delta: number;
	/** Change in percent of the start, rounded to one decimal place. */
	percent: number;
	/** Whether the change raises net worth: an asset that grew or a debt that shrank. */
	improves: boolean;
}

const percentOf = (delta: number, start: number) => Math.round((delta / start) * 1000) / 10;

export function rowChange(row: NetWorthRow): Change {
	const delta = row.end - row.start;
	return {
		delta,
		percent: percentOf(delta, row.start),
		improves: row.kind === "asset" ? delta > 0 : delta < 0,
	};
}

const sumOf = (rows: NetWorthRow[], kind: NetWorthRowKind, at: "start" | "end") =>
	rows.filter((row) => row.kind === kind).reduce((total, row) => total + row[at], 0);

export interface NetWorthSummary {
	assets: number;
	liabilities: number;
	netWorth: number;
	/** Net worth's change from the history's first point to its last. */
	change: Change;
}

export function summarize(sample: NetWorthSample): NetWorthSummary {
	const assets = sumOf(sample.rows, "asset", "end");
	const liabilities = sumOf(sample.rows, "liability", "end");
	const netWorth = assets - liabilities;
	const first = sample.history[0];
	const delta = netWorth - first;
	return {
		assets,
		liabilities,
		netWorth,
		change: { delta, percent: percentOf(delta, first), improves: delta > 0 },
	};
}

/** Net worth at the start of the period, from the rows: must equal the history's first point. */
export function startingNetWorth(sample: NetWorthSample): number {
	return sumOf(sample.rows, "asset", "start") - sumOf(sample.rows, "liability", "start");
}

export interface PlotPoint {
	/** Percent of the plot's width, 0 at the first month. */
	x: number;
	/** Percent of the plot's height from the top, 0 at the highest tick. */
	y: number;
}

export function plotPoints(sample: NetWorthSample): PlotPoint[] {
	const low = sample.yTicks[0];
	const high = sample.yTicks[sample.yTicks.length - 1];
	const step = 100 / (sample.history.length - 1);
	return sample.history.map((value, i) => ({ x: i * step, y: ((high - value) / (high - low)) * 100 }));
}

export function tickY(sample: NetWorthSample, tick: number): number {
	const low = sample.yTicks[0];
	const high = sample.yTicks[sample.yTicks.length - 1];
	return ((high - tick) / (high - low)) * 100;
}

/**
 * A smooth line through the points that never overshoots them (monotone cubic interpolation, as
 * d3's `curveMonotoneX`), so a month's dip stays a dip and no bump appears between two months.
 */
export function smoothPath(points: PlotPoint[]): string {
	const n = points.length;
	if (n < 2) return "";
	const slopes = points.slice(0, -1).map((p, i) => (points[i + 1].y - p.y) / (points[i + 1].x - p.x));
	const tangents = points.map((_, i) => {
		if (i === 0) return slopes[0];
		if (i === n - 1) return slopes[n - 2];
		return slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2;
	});
	// Fritsch–Carlson: scale tangents down where they would overshoot.
	slopes.forEach((slope, i) => {
		if (slope === 0) {
			tangents[i] = 0;
			tangents[i + 1] = 0;
			return;
		}
		const a = tangents[i] / slope;
		const b = tangents[i + 1] / slope;
		const s = a * a + b * b;
		if (s > 9) {
			const tau = 3 / Math.sqrt(s);
			tangents[i] = tau * a * slope;
			tangents[i + 1] = tau * b * slope;
		}
	});
	const r = (v: number) => Math.round(v * 100) / 100;
	let d = `M ${r(points[0].x)} ${r(points[0].y)}`;
	for (let i = 0; i < n - 1; i++) {
		const p = points[i];
		const q = points[i + 1];
		const third = (q.x - p.x) / 3;
		d += ` C ${r(p.x + third)} ${r(p.y + tangents[i] * third)} ${r(q.x - third)} ${r(q.y - tangents[i + 1] * third)} ${r(q.x)} ${r(q.y)}`;
	}
	return d;
}

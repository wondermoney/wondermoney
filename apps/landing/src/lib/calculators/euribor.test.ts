import { describe, expect, it } from "vitest";
import { computeRateRevision } from "./rateRevision";
import {
	EURIBOR_EXAMPLE,
	EURIBOR_HISTORY,
	EURIBOR_SOURCE,
	computeEuriborImpact,
	getEuriborSeries,
	getLatestEuribor,
} from "./euribor";

const history = [
	["2026-08", 2.5131, 2.7133, 2.9537],
	["2026-09", 2.635, 2.9216, 3.247],
	["2026-10", 2.6347, 2.9747, 3.2386],
] as const;

describe("generated data", () => {
	it("is consecutive months from 2000-01 and matches the source summary", () => {
		expect(EURIBOR_HISTORY[0][0]).toBe(EURIBOR_SOURCE.firstMonth);
		expect(EURIBOR_HISTORY.at(-1)?.[0]).toBe(EURIBOR_SOURCE.lastMonth);
		expect(EURIBOR_SOURCE.firstMonth).toBe("2000-01");
		EURIBOR_HISTORY.forEach(([month], i) => {
			if (i === 0) return;
			const [y, m] = EURIBOR_HISTORY[i - 1][0].split("-").map(Number);
			expect(month).toBe(m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`);
		});
		for (const [, a, b, c] of EURIBOR_HISTORY) for (const v of [a, b, c]) expect(Number.isFinite(v)).toBe(true);
	});
});

describe("getLatestEuribor", () => {
	it("returns the last month with the change on the month before, per tenor", () => {
		const latest = getLatestEuribor(history);
		expect(latest.month).toBe("2026-10");
		expect(latest.previousMonth).toBe("2026-09");
		expect(latest.rates.map((r) => [r.tenor, r.rate, r.previousRate, r.change])).toEqual([
			[3, 2.63, 2.63, 0],
			[6, 2.97, 2.92, 0.05],
			[12, 3.24, 3.25, -0.01],
		]);
	});

	it("needs two months", () => {
		expect(() => getLatestEuribor(history.slice(0, 1))).toThrow();
	});
});

describe("getEuriborSeries", () => {
	it("starts at the first January asked for", () => {
		const series = getEuriborSeries(2015);
		expect(series[0].month).toBe("2015-01");
		expect(series.at(-1)?.month).toBe(EURIBOR_SOURCE.lastMonth);
	});
});

describe("computeEuriborImpact", () => {
	const latest = getLatestEuribor(history);

	it("matches the rate revision engine for the same loan", () => {
		const outcome = computeEuriborImpact({ ...EURIBOR_EXAMPLE, tenor: 12, change: 1 }, latest);
		const direct = computeRateRevision({
			balance: 150_000,
			termYears: 25,
			termMonths: 0,
			indexRate: 3.24,
			spread: 1,
			newIndexRate: 4.24,
			monthlyIncome: Number.NaN,
		});
		if (!outcome.ok || !direct.ok) throw new Error("must be valid");
		expect(outcome.result.indexRate).toBe(3.24);
		expect(outcome.result.newIndexRate).toBe(4.24);
		expect(outcome.result.revision.revised.monthlyPayment).toBe(direct.result.revised.monthlyPayment);
		expect(outcome.result.revision.monthlyChange).toBeGreaterThan(0);
	});

	it("uses the chosen tenor's rate", () => {
		const outcome = computeEuriborImpact({ ...EURIBOR_EXAMPLE, tenor: 3 }, latest);
		if (!outcome.ok) throw new Error("must be valid");
		expect(outcome.result.indexRate).toBe(2.63);
	});

	it("shows a fall as a lower payment, floored at a 0% rate", () => {
		const outcome = computeEuriborImpact({ ...EURIBOR_EXAMPLE, spread: 0, change: -4 }, latest);
		if (!outcome.ok) throw new Error("must be valid");
		expect(outcome.result.revision.monthlyChange).toBeLessThan(0);
		expect(outcome.result.revision.revised.floored).toBe(true);
	});

	it("explains an empty or excessive change and invalid loan fields", () => {
		expect(computeEuriborImpact({ ...EURIBOR_EXAMPLE, change: Number.NaN }, latest)).toEqual({
			ok: false,
			errors: { change: "required" },
		});
		expect(computeEuriborImpact({ ...EURIBOR_EXAMPLE, change: 5.5 }, latest)).toEqual({
			ok: false,
			errors: { change: "tooLarge" },
		});
		expect(computeEuriborImpact({ ...EURIBOR_EXAMPLE, change: -6 }, latest)).toEqual({
			ok: false,
			errors: { change: "tooSmall" },
		});
		const bad = computeEuriborImpact({ ...EURIBOR_EXAMPLE, balance: 0, spread: -1, termYears: 0 }, latest);
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["balance", "spread", "termYears"]);
	});
});

describe("scripts/build-euribor.mjs", () => {
	it("parses a BPstat response into consecutive months from 2000-01 and rejects gaps", async () => {
		const { parseBpstat, renderModule } = (await import("../../../scripts/build-euribor.mjs")) as {
			parseBpstat: (json: unknown) => { month: string; m3: number; m6: number; m12: number }[]
			renderModule: (rows: unknown[], fetchedOn: string) => string
		}
		const dates = ["1999-12-31", "2000-01-31", "2000-02-29"]
		const response = (dateList: string[], values: (number | null)[]) => ({
			dimension: {
				"46": { category: { index: ["2748", "2751", "2769"], label: { "2748": "3 months", "2751": "6 months", "2769": "1 year" } } },
				reference_date: { category: { index: dateList } },
			},
			value: values,
		})
		const rows = parseBpstat(response(dates, [1, 2, 3, 4, 5, 6, 7, 8, 9]))
		expect(rows).toEqual([
			{ month: "2000-01", m3: 2, m6: 5, m12: 8 },
			{ month: "2000-02", m3: 3, m6: 6, m12: 9 },
		])
		expect(renderModule(rows, "2026-11-19")).toContain('lastMonth: "2000-02"');
		expect(() => parseBpstat(response(["2000-01-31", "2000-03-31"], [1, 2, 3, 4, 5, 6]))).toThrow(/Gap/)
		expect(() => parseBpstat(response(["2000-01-31"], [1, null, 3]))).toThrow(/No m6/)
	})
})

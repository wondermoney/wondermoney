import { describe, expect, it } from "vitest";

import { findBrandLogo } from "@/lib/brandLogos";

import {
	FEATURE_NET_WORTH,
	HERO_NET_WORTH,
	plotPoints,
	rowChange,
	smoothPath,
	startingNetWorth,
	summarize,
	type NetWorthSample,
} from "./netWorthSample";

const samples: [string, NetWorthSample][] = [
	["hero", HERO_NET_WORTH],
	["feature page", FEATURE_NET_WORTH],
];

describe.each(samples)("the %s net worth sample", (_, sample) => {
	it("adds up: assets minus liabilities is the history's last point, and the rows' starting balances its first", () => {
		// Given the sample's rows and history
		const { assets, liabilities, netWorth } = summarize(sample);

		// Then the totals reconcile with both ends of the chart
		expect(assets - liabilities).toBe(netWorth);
		expect(netWorth).toBe(sample.history[sample.history.length - 1]);
		expect(startingNetWorth(sample)).toBe(sample.history[0]);
	});

	it("gives net worth's change as the sum of the rows' changes, a percent of the chart's first point", () => {
		// When
		const { change } = summarize(sample);
		const fromRows = sample.rows.reduce(
			(total, row) => total + (row.kind === "asset" ? 1 : -1) * rowChange(row).delta,
			0,
		);

		// Then
		expect(change.delta).toBe(fromRows);
		expect(change.percent).toBe(Math.round((change.delta / sample.history[0]) * 1000) / 10);
	});

	it("shows only institutions the product supports, each with a logo in the registry", () => {
		// The banks and brokers `InstitutionMarks.tsx` lists as "works with".
		const supported = ["CGD", "Millennium bcp", "Santander", "novobanco", "ActivoBank", "BPI", "Revolut", "DEGIRO", "Interactive Brokers"];
		for (const row of sample.rows) {
			expect(supported, row.institution).toContain(row.institution);
			expect(findBrandLogo(row.institution), row.institution).not.toBeNull();
		}
	});

	it("has one month per point and keeps every point inside the y-axis ticks", () => {
		// Given
		const low = sample.yTicks[0];
		const high = sample.yTicks[sample.yTicks.length - 1];

		// Then
		expect(sample.months).toHaveLength(sample.history.length);
		for (const value of sample.history) {
			expect(value).toBeGreaterThanOrEqual(low);
			expect(value).toBeLessThanOrEqual(high);
		}
		for (const point of plotPoints(sample)) {
			expect(point.y).toBeGreaterThanOrEqual(0);
			expect(point.y).toBeLessThanOrEqual(100);
		}
	});
});

describe("the sample figures", () => {
	it("show the hero's household up 7.3% over the six months", () => {
		expect(summarize(HERO_NET_WORTH).change).toEqual({ delta: 3650, percent: 7.3, improves: true });
	});

	it("show the feature page's household up 11.0%", () => {
		expect(summarize(FEATURE_NET_WORTH).change).toEqual({ delta: 16300, percent: 11, improves: true });
	});
});

describe("rowChange", () => {
	it("counts an asset that grew and a debt that shrank as raising net worth", () => {
		// Given an asset that grew, a debt that shrank and a debt that grew
		const asset = rowChange({ labelKey: "a", institution: "CGD", kind: "asset", start: 1000, end: 1100 });
		const paidDown = rowChange({ labelKey: "b", institution: "CGD", kind: "liability", start: 800, end: 600 });
		const grew = rowChange({ labelKey: "c", institution: "CGD", kind: "liability", start: 600, end: 690 });

		// Then the sign follows the balance and `improves` follows net worth
		expect(asset).toEqual({ delta: 100, percent: 10, improves: true });
		expect(paidDown).toEqual({ delta: -200, percent: -25, improves: true });
		expect(grew).toEqual({ delta: 90, percent: 15, improves: false });
	});

	it("counts an unchanged balance as not raising net worth", () => {
		expect(rowChange({ labelKey: "a", institution: "CGD", kind: "asset", start: 500, end: 500 }).improves).toBe(false);
	});
});

describe("smoothPath", () => {
	it("passes through every point", () => {
		// Given
		const points = plotPoints(HERO_NET_WORTH);

		// When
		const d = smoothPath(points);

		// Then it starts at the first point and each curve ends on the next one
		const coords = (p: { x: number; y: number }) => `${Math.round(p.x * 100) / 100} ${Math.round(p.y * 100) / 100}`;
		expect(d.startsWith(`M ${coords(points[0])}`)).toBe(true);
		for (const point of points.slice(1)) expect(d).toContain(`${coords(point)}`);
		expect(d.match(/C /g)).toHaveLength(points.length - 1);
	});

	it("never overshoots a flat stretch: the control points of a level segment stay level", () => {
		// Given a rise, a flat month and a rise
		const d = smoothPath([
			{ x: 0, y: 100 },
			{ x: 50, y: 50 },
			{ x: 100, y: 50 },
		]);

		// Then the second curve's control points sit on y = 50
		expect(d).toContain("C 66.67 50 83.33 50 100 50");
	});
});

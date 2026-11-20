import { describe, expect, it } from "vitest"
import {
	BROKER_FEES,
	BROKER_FEES_ASSUMPTIONS,
	BROKER_FEES_REVIEWED,
	SCENARIO_PROFILES,
	brokerYearlyCost,
	compareBrokers,
	daysSinceReview,
	isBrokerFeesStale,
	orderCommission,
	ordersByMonth,
	validateScenario,
	yearlyCommission,
	yearlyCustody,
	yearlyMarketFee,
	type Broker,
	type OrderFee,
	type Scenario,
} from "./brokerFees"

const fee = (overrides: Partial<OrderFee> = {}): OrderFee => ({
	currency: "EUR",
	fixed: 0,
	pct: 0,
	perShare: 0,
	min: 0,
	max: null,
	maxPctOfValue: null,
	freeMonthlyTurnover: null,
	freeOrdersPerMonth: 0,
	tiers: null,
	...overrides,
})

const broker = (overrides: Partial<Broker> = {}): Broker => ({
	id: "test",
	name: "Test",
	entity: "Test Broker B.V.",
	country: "NL",
	regulator: "AFM",
	etfVenue: "Euronext Amsterdam",
	etfEu: fee({ fixed: 3, pct: 0.1 }),
	etfSavingsPlan: null,
	usStock: fee({ fixed: 2, currency: "USD" }),
	fxPct: 0.25,
	custody: { period: "year", pct: 0, fixed: 0, min: 0, max: null, exemptValue: 0 },
	marketFee: null,
	cashInterest: { kind: "none" },
	investorProtection: { scheme: "ieIcs", amount: 20_000, coveragePct: 90, url: "https://example.com" },
	depositGuarantee: null,
	ptTaxReport: null,
	feeTaxes: [],
	note: false,
	sources: [{ label: "Fees", url: "https://example.com/fees" }],
	checked: "2026-11-20",
	...overrides,
})

const scenario = (overrides: Partial<Scenario> = {}): Scenario => ({
	...SCENARIO_PROFILES.monthlyEtf,
	...overrides,
})

describe("orderCommission", () => {
	it("adds the fixed part and the percentage, then applies the minimum and the maximum", () => {
		expect(orderCommission(fee({ fixed: 3, pct: 0.1 }), 200)).toBeCloseTo(3.2)
		expect(orderCommission(fee({ pct: 0.2, min: 10 }), 1_000)).toBe(10)
		expect(orderCommission(fee({ pct: 0.2, min: 10, max: 50 }), 100_000)).toBe(50)
	})

	it("charges per whole share in dollars, capped at a share of the order value, and converts to euros", () => {
		const usd = fee({ currency: "USD", perShare: 0.005, min: 1, maxPctOfValue: 1 })
		// Any normal order pays the USD 1 minimum.
		expect(orderCommission(usd, 1_000)).toBeCloseTo(1 / BROKER_FEES_ASSUMPTIONS.eurUsd)
		// A tiny order is capped at 1% of its value.
		expect(orderCommission(usd, 20)).toBeCloseTo(0.2)
	})

	it("is zero for a zero, negative or missing amount", () => {
		expect(orderCommission(fee({ fixed: 3 }), 0)).toBe(0)
		expect(orderCommission(fee({ fixed: 3 }), -10)).toBe(0)
		expect(orderCommission(fee({ fixed: 3 }), Number.NaN)).toBe(0)
	})
})

describe("yearlyCommission", () => {
	it("spreads the orders evenly over the months", () => {
		expect(ordersByMonth(12)).toEqual(Array(12).fill(1))
		expect(ordersByMonth(14).slice(0, 3)).toEqual([2, 2, 1])
		expect(ordersByMonth(0)).toEqual(Array(12).fill(0))
	})

	it("charges only the turnover above a free monthly allowance", () => {
		const free = fee({ pct: 0.2, min: 10, freeMonthlyTurnover: 100_000 })
		expect(yearlyCommission(free, 12, 200)).toBe(0)
		// 2 orders of 60 000 in each of 12 months: the second order charges 20 000 at 0.2% = 40.
		expect(yearlyCommission(free, 24, 60_000)).toBeCloseTo(12 * 40)
	})

	it("leaves the first orders of each month free when the broker does", () => {
		const firstFree = fee({ fixed: 5, freeOrdersPerMonth: 1 })
		expect(yearlyCommission(firstFree, 12, 200)).toBe(0)
		expect(yearlyCommission(firstFree, 24, 200)).toBe(60)
	})

	it("picks the band of a tiered fee by order value", () => {
		const tiered = fee({
			tiers: [
				{ upTo: 12_000, fixed: 11.95, pct: 0 },
				{ upTo: 250_000, fixed: 0, pct: 0.1 },
				{ upTo: null, fixed: 0, pct: 0.09 },
			],
		})
		expect(orderCommission(tiered, 1_000)).toBe(11.95)
		expect(orderCommission(tiered, 12_000)).toBe(11.95)
		expect(orderCommission(tiered, 20_000)).toBeCloseTo(20)
		expect(orderCommission(tiered, 1_000_000)).toBeCloseTo(900)
	})

	it("multiplies the order fee by the number of orders", () => {
		expect(yearlyCommission(fee({ fixed: 1 }), 6, 1_000)).toBe(6)
		expect(yearlyCommission(fee({ fixed: 1 }), 0, 1_000)).toBe(0)
	})
})

describe("yearlyCustody", () => {
	it("applies the yearly percentage with its minimum and maximum, and nothing on an empty portfolio", () => {
		const custody = { period: "year", pct: 0.2, fixed: 0, min: 20, max: 300, exemptValue: 0 } as const
		expect(yearlyCustody(custody, 2_400)).toBe(20)
		expect(yearlyCustody(custody, 50_000)).toBe(100)
		expect(yearlyCustody(custody, 1_000_000)).toBe(300)
		expect(yearlyCustody(custody, 0)).toBe(0)
	})

	it("charges a per-period formula once per period", () => {
		const semester = { period: "semester", pct: 0.1, fixed: 0, min: 5, max: null, exemptValue: 0 } as const
		expect(yearlyCustody(semester, 2_400)).toBe(10)
		expect(yearlyCustody(semester, 50_000)).toBe(100)
		const monthly = { period: "month", pct: 0, fixed: 1.5, min: 0, max: null, exemptValue: 0 } as const
		expect(yearlyCustody({ period: "year", pct: 0.02, fixed: 0, min: 0, max: null, exemptValue: 250_000 }, 300_000)).toBeCloseTo(10)
		expect(yearlyCustody({ period: "year", pct: 0.02, fixed: 0, min: 0, max: null, exemptValue: 250_000 }, 50_000)).toBe(0)
		expect(yearlyCustody(monthly, 1)).toBe(18)
	})
})

describe("yearlyMarketFee", () => {
	const fee = { perYear: 2.5, maxPctOfPortfolio: 0.25, markets: ["usStock"] } as const
	it("charges the yearly per-exchange fee on its markets only, capped at a share of the value held", () => {
		expect(yearlyMarketFee(fee, scenario(SCENARIO_PROFILES.occasionalStocks))).toBe(2.5)
		expect(yearlyMarketFee(fee, scenario())).toBe(0)
		expect(yearlyMarketFee(fee, scenario({ market: "usStock", portfolio: 400 }))).toBe(1)
		expect(yearlyMarketFee(fee, scenario({ market: "usStock", trades: 0, portfolio: 0 }))).toBe(0)
		expect(yearlyMarketFee(null, scenario(SCENARIO_PROFILES.occasionalStocks))).toBe(0)
	})

	it("is counted with custody", () => {
		const cost = brokerYearlyCost(broker({ marketFee: fee }), scenario(SCENARIO_PROFILES.occasionalStocks))
		expect(cost.custody).toBe(2.5)
		expect(cost.marketFee).toBe(2.5)
	})
})

describe("brokerYearlyCost", () => {
	it("adds trading, FX on US orders, custody and the tax on fees", () => {
		const bank = broker({
			usStock: fee({ pct: 0.5, min: 15 }),
			fxPct: 0.5,
			custody: { period: "year", pct: 0.2, fixed: 0, min: 20, max: null, exemptValue: 0 },
			feeTaxes: [{ kind: "stampDuty", pct: 4, on: ["trading", "custody"] }],
		})
		const cost = brokerYearlyCost(bank, scenario(SCENARIO_PROFILES.occasionalStocks))
		// 6 orders × €15 minimum = 90, +4% = 93.60; FX 0.5% of 6 000 = 30; custody 0.2% of 6 000 = 12 → min 20, +4% = 20.80.
		expect(cost.trading).toBe(93.6)
		expect(cost.fx).toBe(30)
		expect(cost.custody).toBe(20.8)
		expect(cost.feeTax).toBe(4.4)
		expect(cost.total).toBe(144.4)
		expect(cost.missing).toEqual([])
	})

	it("adds stamp duty on commissions and VAT on custody, each on its own fees", () => {
		const bank = broker({
			etfEu: fee({ fixed: 10 }),
			custody: { period: "quarter", pct: 0, fixed: 6, min: 0, max: null, exemptValue: 0 },
			feeTaxes: [
				{ kind: "stampDuty", pct: 4, on: ["trading"] },
				{ kind: "vat", pct: 23, on: ["custody"] },
			],
		})
		const cost = brokerYearlyCost(bank, scenario({ useSavingsPlan: false }))
		// 12 × 10 = 120, +4% = 124.80; custody 4 × 6 = 24, +23% = 29.52
		expect(cost.trading).toBe(124.8)
		expect(cost.custody).toBe(29.52)
		expect(cost.taxes).toEqual([
			{ kind: "stampDuty", pct: 4, amount: 4.8 },
			{ kind: "vat", pct: 23, amount: 5.52 },
		])
		expect(cost.total).toBe(154.32)
	})

	it("adds the tax on fees only to the fees it applies to", () => {
		const fxTaxed = broker({ usStock: fee(), fxPct: 0.35, feeTaxes: [{ kind: "stampDuty", pct: 4, on: ["fx"] }] })
		const cost = brokerYearlyCost(fxTaxed, scenario(SCENARIO_PROFILES.occasionalStocks))
		// 0.35% of 6 000 = 21, +4% = 21.84
		expect(cost.fx).toBe(21.84)
		expect(cost.feeTax).toBe(0.84)
		expect(cost.trading).toBe(0)
	})

	it("uses the savings plan for ETF buys only when asked and published", () => {
		const planBroker = broker({ etfSavingsPlan: fee() })
		expect(brokerYearlyCost(planBroker, scenario()).usedSavingsPlan).toBe(true)
		expect(brokerYearlyCost(planBroker, scenario()).trading).toBe(0)
		expect(brokerYearlyCost(planBroker, scenario({ useSavingsPlan: false })).trading).toBeCloseTo(12 * 3.2)
		expect(brokerYearlyCost(broker(), scenario()).usedSavingsPlan).toBe(false)
	})

	it("flags fees that are not published instead of counting them as zero", () => {
		const unknown = broker({ usStock: null, fxPct: null, custody: null })
		const cost = brokerYearlyCost(unknown, scenario(SCENARIO_PROFILES.occasionalStocks))
		expect(cost.missing).toEqual(["trading", "fx", "custody"])
		// With nothing bought and nothing held, nothing is missing.
		expect(brokerYearlyCost(unknown, scenario({ market: "usStock", trades: 0, portfolio: 0 })).missing).toEqual([])
	})

	it("gives zero for an empty scenario and finite numbers for a very large one", () => {
		const zero = brokerYearlyCost(broker(), scenario({ trades: 0, tradeAmount: 0, portfolio: 0 }))
		expect(zero.total).toBe(0)
		const big = brokerYearlyCost(broker(), scenario({ trades: 1000, tradeAmount: 10_000_000, portfolio: 100_000_000 }))
		expect(Number.isFinite(big.total)).toBe(true)
		expect(big.total).toBeGreaterThan(0)
	})
})

describe("compareBrokers", () => {
	it("sorts cheapest first and puts incomplete estimates last", () => {
		const cheap = broker({ id: "a", name: "A", etfEu: fee({ fixed: 1 }) })
		const dear = broker({ id: "b", name: "B", etfEu: fee({ fixed: 5 }) })
		const unknown = broker({ id: "c", name: "C", etfEu: null })
		expect(compareBrokers(scenario({ useSavingsPlan: false }), [unknown, dear, cheap]).map((c) => c.broker.id)).toEqual([
			"a",
			"b",
			"c",
		])
	})
})

describe("validateScenario", () => {
	it("rejects empty, negative, fractional and oversized inputs and accepts zero", () => {
		expect(validateScenario(scenario({ trades: 0, tradeAmount: 0, portfolio: 0 }))).toEqual([])
		expect(validateScenario(scenario({ trades: Number.NaN }))).toEqual(["trades"])
		expect(validateScenario(scenario({ trades: 1.5 }))).toEqual(["trades"])
		expect(validateScenario(scenario({ tradeAmount: -1 }))).toEqual(["tradeAmount"])
		expect(validateScenario(scenario({ portfolio: 1e12 }))).toEqual(["portfolio"])
	})
})

describe("staleness", () => {
	it("counts days from the review date and turns stale after about four months", () => {
		expect(daysSinceReview(new Date("2026-11-21T12:00:00Z"), "2026-11-20")).toBe(1)
		expect(isBrokerFeesStale(new Date("2027-02-20T00:00:00Z"), "2026-11-20")).toBe(false)
		expect(isBrokerFeesStale(new Date("2027-04-01T00:00:00Z"), "2026-11-20")).toBe(true)
	})
})

describe("the dated data", () => {
	it("has a review date, a source and a checked date on every broker, from the broker's own site", () => {
		expect(BROKER_FEES_REVIEWED).toMatch(/^\d{4}-\d{2}-\d{2}$/)
		expect(BROKER_FEES.length).toBeGreaterThanOrEqual(8)
		const ids = new Set<string>()
		for (const item of BROKER_FEES) {
			expect(ids.has(item.id)).toBe(false)
			ids.add(item.id)
			expect(item.sources.length).toBeGreaterThan(0)
			for (const source of item.sources) expect(source.url).toMatch(/^https:\/\//)
			expect(item.checked <= BROKER_FEES_REVIEWED).toBe(true)
			expect(item.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/)
		}
	})

	it("estimates every profile for every broker without NaN", () => {
		for (const profile of Object.values(SCENARIO_PROFILES)) {
			for (const cost of compareBrokers(profile)) {
				expect(Number.isFinite(cost.total)).toBe(true)
				expect(cost.total).toBeGreaterThanOrEqual(0)
			}
		}
	})
})

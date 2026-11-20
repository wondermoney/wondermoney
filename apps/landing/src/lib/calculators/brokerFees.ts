import {
	BROKER_FEES,
	BROKER_FEES_ASSUMPTIONS,
	BROKER_FEES_REVIEWED,
	type Broker,
	type CustodyFee,
	type FeeKind,
	type FeeTax,
	type MarketFee,
	type OrderFee,
} from "./data/brokerFees"

export { BROKER_FEES, BROKER_FEES_ASSUMPTIONS, BROKER_FEES_REVIEWED } from "./data/brokerFees"
export type { Broker, CustodyFee, FeeKind, FeeTax, MarketFee, OrderFee, SchemeId } from "./data/brokerFees"

/** The data is re-checked every quarter; past this many days the page says it may be out of date. */
export const BROKER_FEES_STALE_AFTER_DAYS = 122

export const BROKER_FEES_LIMITS = {
	maxTrades: 1000,
	maxTradeAmount: 10_000_000,
	maxPortfolio: 100_000_000,
} as const

export type Market = "etfEu" | "usStock"

export interface Scenario {
	market: Market
	/** Buy orders in the year, spread evenly over its 12 months. */
	trades: number
	/** Value of each order, in euros. */
	tradeAmount: number
	/** Value held through the year, in euros, for the custody fee. */
	portfolio: number
	/** Use the broker's recurring savings plan for ETF buys where it publishes one. */
	useSavingsPlan: boolean
}

export const SCENARIO_PROFILES = {
	monthlyEtf: { market: "etfEu", trades: 12, tradeAmount: 200, portfolio: 2_400, useSavingsPlan: true },
	occasionalStocks: { market: "usStock", trades: 6, tradeAmount: 1_000, portfolio: 6_000, useSavingsPlan: false },
	largePortfolio: { market: "etfEu", trades: 4, tradeAmount: 2_500, portfolio: 50_000, useSavingsPlan: false },
} as const satisfies Record<string, Scenario>

export type ProfileId = keyof typeof SCENARIO_PROFILES
export const PROFILE_IDS = Object.keys(SCENARIO_PROFILES) as ProfileId[]

export type ScenarioError = "trades" | "tradeAmount" | "portfolio"

/** The fields that are empty, negative, fractional (trades) or above the limits. */
export function validateScenario(scenario: Scenario): ScenarioError[] {
	const errors: ScenarioError[] = []
	const { trades, tradeAmount, portfolio } = scenario
	if (!Number.isFinite(trades) || trades < 0 || !Number.isInteger(trades) || trades > BROKER_FEES_LIMITS.maxTrades)
		errors.push("trades")
	if (!Number.isFinite(tradeAmount) || tradeAmount < 0 || tradeAmount > BROKER_FEES_LIMITS.maxTradeAmount)
		errors.push("tradeAmount")
	if (!Number.isFinite(portfolio) || portfolio < 0 || portfolio > BROKER_FEES_LIMITS.maxPortfolio)
		errors.push("portfolio")
	return errors
}

const round2 = (value: number) => Math.round(value * 100) / 100

/** Euros to the fee's currency, at the page's stated EUR/USD rate. */
function toCurrency(eur: number, currency: OrderFee["currency"]): number {
	return currency === "USD" ? eur * BROKER_FEES_ASSUMPTIONS.eurUsd : eur
}

function toEur(amount: number, currency: OrderFee["currency"]): number {
	return currency === "USD" ? amount / BROKER_FEES_ASSUMPTIONS.eurUsd : amount
}

/**
 * The commission on one order of `chargedEur` euros (the part above any free allowance), in euros,
 * before any tax on the fee. Per-share fees count whole shares at the page's assumed share price.
 */
export function orderCommission(fee: OrderFee, chargedEur: number): number {
	if (!(chargedEur > 0)) return 0
	const value = toCurrency(chargedEur, fee.currency)
	const shares = Math.max(1, Math.round(value / BROKER_FEES_ASSUMPTIONS.sharePrice))
	const tier = fee.tiers ? (fee.tiers.find((band) => band.upTo === null || value <= band.upTo) ?? fee.tiers[fee.tiers.length - 1]) : fee
	let commission = tier.fixed + (tier.pct / 100) * value + fee.perShare * (fee.perShare > 0 ? shares : 0)
	commission = Math.max(commission, fee.min)
	if (fee.max !== null) commission = Math.min(commission, fee.max)
	if (fee.maxPctOfValue !== null) commission = Math.min(commission, (fee.maxPctOfValue / 100) * value)
	return toEur(commission, fee.currency)
}

/** How many of `trades` orders fall in each month when they are spread evenly over the year. */
export function ordersByMonth(trades: number): number[] {
	const base = Math.floor(trades / 12)
	const extra = trades % 12
	return Array.from({ length: 12 }, (_, month) => base + (month < extra ? 1 : 0))
}

/**
 * Commission on every order of the year, in euros, month by month: the free orders of each month
 * first, then a free monthly turnover, then the order fee on what is left.
 */
export function yearlyCommission(fee: OrderFee, trades: number, tradeAmount: number): number {
	if (trades <= 0 || tradeAmount <= 0) return 0
	let total = 0
	for (const orders of ordersByMonth(trades)) {
		let turnover = 0
		for (let order = 0; order < orders; order += 1) {
			if (order < fee.freeOrdersPerMonth) continue
			if (fee.freeMonthlyTurnover === null) {
				total += orderCommission(fee, tradeAmount)
				continue
			}
			const before = turnover
			turnover += tradeAmount
			const charged = turnover - Math.max(before, fee.freeMonthlyTurnover)
			if (charged > 0) total += orderCommission(fee, Math.min(charged, tradeAmount))
		}
	}
	return total
}

export const CUSTODY_PERIODS_PER_YEAR = { month: 12, quarter: 4, semester: 2, year: 1 } as const

/**
 * The yearly custody fee, in euros, before any tax on the fee: the published per-period formula,
 * with its minimum and maximum, charged on the same value every period. Nothing held, nothing charged.
 */
export function yearlyCustody(fee: CustodyFee, portfolio: number): number {
	if (!(portfolio > 0)) return 0
	let perPeriod = fee.fixed + (fee.pct / 100) * Math.max(0, portfolio - fee.exemptValue)
	perPeriod = Math.max(perPeriod, fee.min)
	if (fee.max !== null) perPeriod = Math.min(perPeriod, fee.max)
	return perPeriod * CUSTODY_PERIODS_PER_YEAR[fee.period]
}

/**
 * A per-exchange yearly fee (DEGIRO's connectivity fee) for the scenario's market, capped at a
 * share of the value held. Nothing held and nothing bought, nothing charged.
 */
export function yearlyMarketFee(fee: MarketFee | null, scenario: Scenario): number {
	if (!fee || !fee.markets.includes(scenario.market)) return 0
	const active = scenario.portfolio > 0 || (scenario.trades > 0 && scenario.tradeAmount > 0)
	if (!active) return 0
	const cap = fee.maxPctOfPortfolio === null ? Infinity : (fee.maxPctOfPortfolio / 100) * Math.max(scenario.portfolio, 0)
	return Math.min(fee.perYear, cap)
}

export type MissingFee = "trading" | "fx" | "custody"

export interface BrokerCost {
	broker: Broker
	/** The fee schedule used for the orders: the regular order fee, or the savings plan. */
	orderFee: OrderFee | null
	usedSavingsPlan: boolean
	/** Commission on all orders, tax on fees included, in euros. */
	trading: number
	/** Currency conversion on US orders, tax on fees included, in euros. */
	fx: number
	/** Custody, account and per-exchange fees for the year, tax on fees included, in euros. */
	custody: number
	/** The per-exchange yearly fee included in `custody`, before tax on fees. */
	marketFee: number
	/** Taxes on fees (stamp duty, VAT) included in trading, fx and custody. */
	feeTax: number
	/** The same taxes one by one, in euros. */
	taxes: { kind: FeeTax["kind"]; pct: number; amount: number }[]
	total: number
	/** Fees the broker does not publish for this scenario: the total leaves them out. */
	missing: MissingFee[]
}

/** The estimated yearly cost of one scenario at one broker. */
export function brokerYearlyCost(broker: Broker, scenario: Scenario): BrokerCost {
	const missing: MissingFee[] = []
	const plan = scenario.market === "etfEu" && scenario.useSavingsPlan ? broker.etfSavingsPlan : null
	const orderFee = plan ?? (scenario.market === "etfEu" ? broker.etfEu : broker.usStock)
	const ordersPlaced = scenario.trades > 0 && scenario.tradeAmount > 0
	let commission = 0
	if (orderFee) commission = yearlyCommission(orderFee, scenario.trades, scenario.tradeAmount)
	else if (ordersPlaced) missing.push("trading")

	let fx = 0
	if (scenario.market === "usStock" && ordersPlaced) {
		if (broker.fxPct === null) missing.push("fx")
		else fx = (broker.fxPct / 100) * scenario.tradeAmount * scenario.trades
	}

	let custodyBase = 0
	if (broker.custody) custodyBase = yearlyCustody(broker.custody, scenario.portfolio)
	else if (scenario.portfolio > 0) missing.push("custody")
	const marketFee = yearlyMarketFee(broker.marketFee, scenario)
	custodyBase += marketFee

	const base: Record<FeeKind, number> = { trading: commission, fx, custody: custodyBase }
	const taxRate = (fee: FeeKind) =>
		broker.feeTaxes.reduce((sum, tax) => sum + (tax.on.includes(fee) ? tax.pct / 100 : 0), 0)
	const taxes = broker.feeTaxes.map((tax) => ({
		kind: tax.kind,
		pct: tax.pct,
		amount: round2(tax.on.reduce((sum, fee) => sum + (base[fee] * tax.pct) / 100, 0)),
	}))
	const feeTax = taxes.reduce((sum, tax) => sum + tax.amount, 0)
	const trading = round2(commission * (1 + taxRate("trading")))
	const custody = round2(custodyBase * (1 + taxRate("custody")))
	const fxRounded = round2(fx * (1 + taxRate("fx")))
	return {
		broker,
		orderFee,
		usedSavingsPlan: plan !== null,
		trading,
		fx: fxRounded,
		custody,
		marketFee: round2(marketFee),
		feeTax: round2(feeTax),
		taxes,
		total: round2(trading + fxRounded + custody),
		missing,
	}
}

/**
 * Every broker's yearly cost, cheapest first. Brokers missing a fee the scenario needs go last,
 * since their total is incomplete; ties keep the name order so the list is stable.
 */
export function compareBrokers(scenario: Scenario, brokers: readonly Broker[] = BROKER_FEES): BrokerCost[] {
	return brokers
		.map((broker) => brokerYearlyCost(broker, scenario))
		.sort(
			(a, b) =>
				Number(a.missing.length > 0) - Number(b.missing.length > 0) ||
				a.total - b.total ||
				a.broker.name.localeCompare(b.broker.name, "en"),
		)
}

/** Whole days from the review date to `now`. */
export function daysSinceReview(now: Date, reviewed: string = BROKER_FEES_REVIEWED): number {
	const reviewedAt = Date.parse(`${reviewed}T00:00:00Z`)
	return Math.floor((now.getTime() - reviewedAt) / 86_400_000)
}

export function isBrokerFeesStale(now: Date, reviewed: string = BROKER_FEES_REVIEWED): boolean {
	return daysSinceReview(now, reviewed) > BROKER_FEES_STALE_AFTER_DAYS
}

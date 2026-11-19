import type { FreeBankAccount } from "./data/freeBankAccounts"
import type { RemuneratedAccount, RemuneratedAccountType } from "./data/remuneratedAccounts"

/** Autonomous rate on deposit interest, withheld by Portuguese banks and declared for foreign ones. */
export const BANK_INTEREST_TAX_RATE = 28
export const BANK_INTEREST_MAX_AMOUNT = 10_000_000
export const BANK_INTEREST_EXAMPLE_AMOUNT = 10_000

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

/** "1 234,56" or "1,50" from the table's notes to a number. */
function parsePtNumber(text: string): number {
	return Number(text.replace(/\s/g, "").replace(",", "."))
}

// ---------------------------------------------------------------------------------------------
// Free accounts
// ---------------------------------------------------------------------------------------------

export type FreeAccountGroup = "branches" | "branchless"

/** The table's own notes say whether a bank has no branches ("Sem balcões ..."). */
export function freeAccountGroup(account: FreeBankAccount): FreeAccountGroup {
	return account.notes.some((note) => note.startsWith("Sem balcões")) ? "branchless" : "branches"
}

export function isForeignFreeAccount(account: FreeBankAccount): boolean {
	return account.notes.some((note) => note.startsWith("Estrangeiro"))
}

export function filterFreeAccounts(
	accounts: readonly FreeBankAccount[],
	filters: { twoHoldersOnly: boolean },
): FreeBankAccount[] {
	return accounts.filter((account) => !filters.twoHoldersOnly || account.twoHolders)
}

export function groupFreeAccounts(accounts: readonly FreeBankAccount[]): Record<FreeAccountGroup, FreeBankAccount[]> {
	return {
		branches: accounts.filter((account) => freeAccountGroup(account) === "branches"),
		branchless: accounts.filter((account) => freeAccountGroup(account) === "branchless"),
	}
}


// ---------------------------------------------------------------------------------------------
// Remunerated accounts: filters and sorting
// ---------------------------------------------------------------------------------------------

export type IbanFilter = "any" | "withIban" | "withoutIban"
export type TaxFilter = "any" | "withheld" | "foreign"
export type SortKey = "tanbDesc" | "tanbAsc" | "netDesc"

export interface RemuneratedFilters {
	type: RemuneratedAccountType | "any"
	iban: IbanFilter
	twoHoldersOnly: boolean
	tax: TaxFilter
}

export const DEFAULT_REMUNERATED_FILTERS: RemuneratedFilters = {
	type: "any",
	iban: "any",
	twoHoldersOnly: false,
	tax: "any",
}

export function filterRemuneratedAccounts(
	accounts: readonly RemuneratedAccount[],
	filters: RemuneratedFilters,
): RemuneratedAccount[] {
	return accounts.filter((account) => {
		if (filters.type !== "any" && account.type !== filters.type) return false
		// Only the two savings types are classed by IBAN; asking for either excludes the rest.
		if (filters.iban === "withIban" && account.type !== "poupancaComIban") return false
		if (filters.iban === "withoutIban" && account.type !== "poupancaSemIban") return false
		if (filters.twoHoldersOnly && account.twoHolders === "no") return false
		if (filters.tax === "withheld" && account.irsNotWithheld) return false
		if (filters.tax === "foreign" && !account.irsNotWithheld) return false
		return true
	})
}

export function isRateRange(account: RemuneratedAccount): boolean {
	return account.tanbMin !== account.tanbMax
}

export function sortRemuneratedAccounts<T extends { account: RemuneratedAccount; netHigh?: number | null }>(
	rows: readonly T[],
	sort: SortKey,
): T[] {
	const index = new Map(rows.map((row, position) => [row, position]))
	const primary = (a: T, b: T) => {
		if (sort === "tanbDesc") return b.account.tanbMax - a.account.tanbMax || b.account.tanbMin - a.account.tanbMin
		if (sort === "tanbAsc") return a.account.tanbMin - b.account.tanbMin || a.account.tanbMax - b.account.tanbMax
		return (b.netHigh ?? Number.NEGATIVE_INFINITY) - (a.netHigh ?? Number.NEGATIVE_INFINITY)
	}
	const compare = (a: T, b: T) => primary(a, b) || (index.get(a) as number) - (index.get(b) as number)
	return rows.slice().sort(compare)
}

// ---------------------------------------------------------------------------------------------
// Net interest over 12 months
// ---------------------------------------------------------------------------------------------

export interface RatePlan {
	name: string
	ratePct: number
	/** Explicit monthly fee from the notes; 0 for "sem custo". */
	monthlyFee: number
	/** The yearly price the notes give as an alternative, shown only. */
	yearlyFee: number | null
}

const PLAN_LINE =
	/^(\d+(?:,\d+)?)% na conta (\S+), (sem custo|com custo (\d+(?:,\d+)?)€\/mês(?: ou (\d+(?:,\d+)?)€\/ano)?)/

/** Plans in the notes: "2,20% na conta Core, com custo 1,99€/mês". Lines that do not match are ignored. */
export function parseRatePlans(notes: readonly string[]): RatePlan[] {
	const plans: RatePlan[] = []
	for (const note of notes) {
		const match = PLAN_LINE.exec(note)
		if (!match) continue
		plans.push({
			name: match[2],
			ratePct: parsePtNumber(match[1]),
			monthlyFee: match[4] ? parsePtNumber(match[4]) : 0,
			yearlyFee: match[5] ? parsePtNumber(match[5]) : null,
		})
	}
	return plans
}

const FLAT_FEE_LINE = /^Plano com custo (\d+(?:,\d+)?)€\/mês/

/** One explicit monthly plan fee for the whole row ("Plano com custo 8,99€/mês"), else null. */
export function parseFlatMonthlyFee(notes: readonly string[]): number | null {
	for (const note of notes) {
		const match = FLAT_FEE_LINE.exec(note)
		if (match) return parsePtNumber(match[1])
	}
	return null
}

export interface RateTier {
	/** Balance above which the rate applies. */
	from: number
	/** Balance up to which it applies; null for no limit. */
	to: number | null
	ratePct: number
}

const TIER_LINE = /^(\d+(?:,\d+)?)% sobre saldo acima de ([\d\s]+)€(?: até ([\d\s]+)€)?/

/** Tiers in the notes: "2,28% sobre saldo acima de 10 000€ até 25 000€". Empty when there are none. */
export function parseRateTiers(notes: readonly string[]): RateTier[] {
	const tiers: RateTier[] = []
	for (const note of notes) {
		const match = TIER_LINE.exec(note)
		if (!match) continue
		tiers.push({
			from: parsePtNumber(match[2]),
			to: match[3] ? parsePtNumber(match[3]) : null,
			ratePct: parsePtNumber(match[1]),
		})
	}
	return tiers
}

export type NetInterestError = "required" | "negative" | "tooLarge"

export interface NetInterest {
	/** Part of the amount that earns interest. */
	earningAmount: number
	gross: number
	tax: number
	fees: number
	net: number
	ratePct: number
	/** True when the amount is above the cap and the excess earns nothing. */
	capped: boolean
	belowMinimum: boolean
}

function bandedGross(amount: number, baseRate: number, tiers: readonly RateTier[]) {
	const sorted = tiers.slice().sort((a, b) => a.from - b.from)
	let gross = 0
	let earning = 0
	let cursor = 0
	const bands = [{ from: 0, to: sorted[0]?.from ?? null, ratePct: baseRate }, ...sorted]
	for (const band of bands) {
		const upper = band.to === null ? Number.POSITIVE_INFINITY : band.to
		const portion = Math.max(0, Math.min(amount, upper) - Math.max(cursor, band.from))
		gross += (portion * band.ratePct) / 100
		earning += portion
		cursor = Math.max(cursor, Math.min(amount, upper))
	}
	return { gross, earning }
}

/**
 * Net interest over 12 months for one rate, after the 28% tax and any explicit monthly fee.
 *
 * Simple interest at the nominal yearly rate on the balance as given; interest is earned only up
 * to the account's maximum (unless the table says "see notes" for it), and below the minimum the
 * account is not available (nothing earned). Tiers parsed from the notes replace the flat rate.
 */
export function computeNetInterest(
	account: RemuneratedAccount,
	amount: number,
	options: { ratePct?: number; monthlyFee?: number } = {},
): { ok: true; result: NetInterest } | { ok: false; error: NetInterestError } {
	if (!Number.isFinite(amount)) return { ok: false, error: "required" }
	if (amount < 0) return { ok: false, error: "negative" }
	if (amount > BANK_INTEREST_MAX_AMOUNT) return { ok: false, error: "tooLarge" }

	const ratePct = options.ratePct ?? account.tanbMax
	const monthlyFee = options.monthlyFee ?? 0
	const belowMinimum = account.minimum !== null && !account.minimumSeeNotes && amount < account.minimum && amount > 0
	const tiers = parseRateTiers(account.notes)

	let gross: number
	let earningAmount: number
	let capped = false
	if (belowMinimum) {
		gross = 0
		earningAmount = 0
	} else if (tiers.length > 0 && options.ratePct === undefined) {
		;({ gross, earning: earningAmount } = bandedGross(amount, ratePct, tiers))
	} else {
		const cap = account.maximum !== null && !account.maximumSeeNotes ? account.maximum : Number.POSITIVE_INFINITY
		earningAmount = Math.min(amount, cap)
		capped = amount > cap
		gross = (earningAmount * ratePct) / 100
	}

	gross = round2(gross)
	const tax = round2((gross * BANK_INTEREST_TAX_RATE) / 100)
	const fees = round2(monthlyFee * 12)
	return {
		ok: true,
		result: {
			earningAmount: round2(earningAmount),
			gross,
			tax,
			fees,
			net: round2(gross - tax - fees),
			ratePct,
			capped,
			belowMinimum,
		},
	}
}

export interface PlanOutcome {
	plan: RatePlan
	result: NetInterest
}

export interface RowProjection {
	account: RemuneratedAccount
	/** The single-rate outcome; null for a rate range, where `plans` carry the figures. */
	single: NetInterest | null
	plans: PlanOutcome[]
	/** Lowest and highest net across the row's outcomes; the sort key and the range shown. */
	netLow: number | null
	netHigh: number | null
}

/** Projects one row for an amount. A range is never collapsed into one number. */
export function projectRow(account: RemuneratedAccount, amount: number): RowProjection | null {
	if (isRateRange(account)) {
		const outcomes: PlanOutcome[] = []
		for (const plan of parseRatePlans(account.notes)) {
			const outcome = computeNetInterest(account, amount, { ratePct: plan.ratePct, monthlyFee: plan.monthlyFee })
			if (!outcome.ok) return null
			outcomes.push({ plan, result: outcome.result })
		}
		const nets = outcomes.map((outcome) => outcome.result.net)
		return {
			account,
			single: null,
			plans: outcomes,
			netLow: nets.length ? Math.min(...nets) : null,
			netHigh: nets.length ? Math.max(...nets) : null,
		}
	}
	const fee = parseFlatMonthlyFee(account.notes) ?? 0
	const outcome = computeNetInterest(account, amount, { monthlyFee: fee })
	if (!outcome.ok) return null
	return { account, single: outcome.result, plans: [], netLow: outcome.result.net, netHigh: outcome.result.net }
}


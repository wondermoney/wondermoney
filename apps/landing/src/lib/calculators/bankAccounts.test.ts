import { describe, expect, it } from "vitest"
import {
	DEFAULT_REMUNERATED_FILTERS,
	computeNetInterest,
	filterFreeAccounts,
	filterRemuneratedAccounts,
	freeAccountGroup,
	groupFreeAccounts,
	parseFlatMonthlyFee,
	parseRatePlans,
	parseRateTiers,
	projectRow,
	sortRemuneratedAccounts,
} from "./bankAccounts"
import { BANK_ACCOUNTS_SOURCE } from "./data/bankAccountsSource"
import { FREE_BANK_ACCOUNTS } from "./data/freeBankAccounts"
import { REMUNERATED_ACCOUNTS, type RemuneratedAccount } from "./data/remuneratedAccounts"

const row = (id: string) => {
	const found = REMUNERATED_ACCOUNTS.find((account) => account.id === id)
	if (!found) throw new Error(id)
	return found
}
const free = (id: string) => {
	const found = FREE_BANK_ACCOUNTS.find((account) => account.id === id)
	if (!found) throw new Error(id)
	return found
}

describe("bank account data", () => {
	it("is dated and attributed", () => {
		expect(BANK_ACCOUNTS_SOURCE.asOf).toBe("2026-11-19")
		expect(BANK_ACCOUNTS_SOURCE.note).toBe("Conditions compiled by WonderMoney from the banks' published offers")
	})

	it("pins the row counts and unique ids", () => {
		expect(FREE_BANK_ACCOUNTS).toHaveLength(14)
		expect(REMUNERATED_ACCOUNTS).toHaveLength(15)
		for (const list of [FREE_BANK_ACCOUNTS, REMUNERATED_ACCOUNTS]) {
			expect(new Set(list.map((account) => account.id)).size).toBe(list.length)
		}
	})

	it("transcribes distinctive remunerated rows", () => {
		expect(row("bankinter-conta-mais-ordenado")).toMatchObject({
			tanbMin: 5,
			tanbMax: 5,
			termMonths: 12,
			type: "ordem",
			maximum: 10_000,
			twoHolders: "yes",
			instantTransfer: true,
			irsNotWithheld: false,
		})
		expect(row("advanzia-deposit-account")).toMatchObject({
			tanbMax: 4.1,
			termMonths: 3,
			minimum: 5_000,
			maximum: 1_000_000,
			irsNotWithheld: true,
			instantTransfer: false,
		})
		expect(row("bunq-savings-account")).toMatchObject({ twoHolders: "paidPlan", termSeeNotes: true, maximum: 100_000 })
		expect(row("klarna-conta-flex")).toMatchObject({ tanbMin: 2.2, tanbMax: 2.7, maximum: null })
		expect(row("revolut-poupanca-acesso-imediato")).toMatchObject({ tanbMin: 1.5, tanbMax: 2.75, maximum: 100_000 })
		expect(row("banco-ctt-conta-poupanca-livre")).toMatchObject({ minimum: 5_000, minimumSeeNotes: true, maximum: 5_000 })
		expect(row("fidelidade-savings-seguro")).toMatchObject({ type: "seguro", minimum: 25, termSeeNotes: true })
	})

	it("keeps the public-debt row highlighted and the merged 3.00%, 2.50% and 2.00% cells on every row", () => {
		const igcp = row("igcp-certificados-aforro-serie-f")
		expect(igcp).toMatchObject({ type: "dividaPublica", highlighted: true, minimum: 100, maximum: 250_000, termMonths: 3 })
		expect(REMUNERATED_ACCOUNTS.filter((account) => account.tanbMax === 3).map((account) => account.entity)).toEqual([
			"Banco CTT",
			"Bankinter",
		])
		expect(REMUNERATED_ACCOUNTS.filter((account) => account.tanbMax === 2.5).map((account) => account.entity)).toEqual([
			"IGCP",
			"Openbank",
		])
		expect(REMUNERATED_ACCOUNTS.filter((account) => account.tanbMax === 2).map((account) => account.entity)).toEqual([
			"ActivoBank",
			"MeDirect",
			"Openbank",
		])
		expect(REMUNERATED_ACCOUNTS.filter((account) => account.irsNotWithheld).map((account) => account.entity)).toEqual([
			"Advanzia Bank",
			"bunq",
			"FCM Bank",
			"Openbank",
			"Klarna",
			"MeDirect",
			"Openbank",
		])
	})

	it("transcribes the free accounts and splits the merged notes cell per bank", () => {
		expect(free("revolut-standard")).toMatchObject({ twoHolders: true, account: "Standard" })
		expect(free("bpi-plano-livre").notes).toEqual([])
		expect(free("moey")).toMatchObject({ twoHolders: false, account: null })
		expect(FREE_BANK_ACCOUNTS.filter((account) => account.twoHolders).map((account) => account.bank)).toEqual([
			"Activo Bank",
			"BAI Europa",
			"Banco CTT",
			"Bankinter",
			"Best",
			"BPI",
			"Revolut",
			"MeDirect",
			"N26",
		])
		for (const id of ["bunq-free", "klarna-standard"]) {
			expect(free(id).notes).toContain("Sem cartão físico no plano gratuito")
			expect(free(id).notes).not.toContain("Cartão físico tem custo inicial")
		}
		expect(free("n26-standard").notes).toContain("Cartão físico tem custo inicial")
		expect(free("n26-standard").notes).not.toContain("Sem cartão físico no plano gratuito")
		for (const id of ["medirect", "openbank"]) {
			expect(free(id).notes).not.toContain("Sem cartão físico no plano gratuito")
			expect(free(id).notes).not.toContain("Cartão físico tem custo inicial")
		}
		for (const id of ["bunq-free", "klarna-standard", "medirect", "n26-standard", "openbank"]) {
			expect(free(id).notes[0]).toBe("Estrangeiro, a declarar no IRS")
			expect(free(id).notes.some((note) => note.startsWith("("))).toBe(false)
		}
	})
})

describe("filters, groups and sorting", () => {
	it("filters free accounts by two holders and groups by branch access from the notes", () => {
		expect(filterFreeAccounts(FREE_BANK_ACCOUNTS, { twoHoldersOnly: true })).toHaveLength(9)
		expect(filterFreeAccounts(FREE_BANK_ACCOUNTS, { twoHoldersOnly: false })).toHaveLength(14)
		expect(freeAccountGroup(free("moey"))).toBe("branchless")
		expect(freeAccountGroup(free("best-digital"))).toBe("branches")
		const groups = groupFreeAccounts(FREE_BANK_ACCOUNTS)
		expect(groups.branches.map((account) => account.bank)).toEqual([
			"Activo Bank",
			"BAI Europa",
			"Banco CTT",
			"Bankinter",
			"Best",
			"BPI",
		])
		expect(groups.branches.length + groups.branchless.length).toBe(14)
	})

	it("filters remunerated accounts by type, IBAN, two holders and tax treatment", () => {
		const ids = (filters: Partial<typeof DEFAULT_REMUNERATED_FILTERS>) =>
			filterRemuneratedAccounts(REMUNERATED_ACCOUNTS, { ...DEFAULT_REMUNERATED_FILTERS, ...filters }).map((a) => a.id)
		expect(ids({})).toHaveLength(15)
		expect(ids({ type: "ordem" })).toEqual(["bankinter-conta-mais-ordenado", "bankinter-conta-online"])
		expect(ids({ type: "dividaPublica" })).toEqual(["igcp-certificados-aforro-serie-f"])
		expect(ids({ iban: "withIban" })).toHaveLength(6)
		expect(ids({ iban: "withoutIban" })).toHaveLength(5)
		expect(ids({ twoHoldersOnly: true })).toHaveLength(7)
		expect(ids({ tax: "foreign" })).toHaveLength(7)
		expect(ids({ tax: "withheld" })).toHaveLength(8)
		expect(ids({ tax: "foreign", twoHoldersOnly: true })).toEqual(["bunq-savings-account"])
	})

	it("sorts by rate, ranges by their ends, and ties keep the table order", () => {
		const rows = REMUNERATED_ACCOUNTS.map((account) => ({ account }))
		const desc = sortRemuneratedAccounts(rows, "tanbDesc").map((r) => r.account.id)
		expect(desc[0]).toBe("bankinter-conta-mais-ordenado")
		expect(desc.indexOf("revolut-poupanca-acesso-imediato")).toBeLessThan(desc.indexOf("fidelidade-savings-seguro"))
		const asc = sortRemuneratedAccounts(rows, "tanbAsc").map((r) => r.account.id)
		expect(asc[0]).toBe("revolut-poupanca-acesso-imediato")
		expect(asc[asc.length - 1]).toBe("bankinter-conta-mais-ordenado")
	})
})

describe("net interest over 12 months", () => {
	it("takes 28% off the interest", () => {
		const result = computeNetInterest(row("bankinter-conta-online"), 10_000)
		expect(result).toEqual({
			ok: true,
			result: expect.objectContaining({ gross: 300, tax: 84, fees: 0, net: 216, capped: false }),
		})
	})

	it("earns interest only up to the account's maximum", () => {
		const outcome = computeNetInterest(row("bankinter-conta-mais-ordenado"), 50_000)
		expect(outcome).toMatchObject({ ok: true, result: { earningAmount: 10_000, gross: 500, net: 360, capped: true } })
		expect(computeNetInterest(row("banco-ctt-conta-poupanca-livre"), 20_000)).toMatchObject({
			result: { earningAmount: 5_000, gross: 150 },
		})
	})

	it("does not treat a minimum the table qualifies as a hard limit, but does enforce a plain one", () => {
		expect(computeNetInterest(row("advanzia-deposit-account"), 1_000)).toMatchObject({
			result: { belowMinimum: true, gross: 0, net: 0 },
		})
		expect(computeNetInterest(row("banco-ctt-conta-poupanca-livre"), 1_000)).toMatchObject({
			result: { belowMinimum: false, gross: 30 },
		})
		expect(computeNetInterest(row("advanzia-deposit-account"), 5_000)).toMatchObject({ result: { gross: 205 } })
	})

	it("applies the tiers in the notes and ignores a 'see notes' maximum", () => {
		const fcm = row("fcm-bank-top-saver-pro")
		expect(parseRateTiers(fcm.notes)).toEqual([
			{ from: 10_000, to: 25_000, ratePct: 2.28 },
			{ from: 25_000, to: null, ratePct: 1.78 },
		])
		// 10 000 at 2.68, 15 000 at 2.28, 5 000 at 1.78
		const outcome = computeNetInterest(fcm, 30_000)
		expect(outcome).toMatchObject({ ok: true, result: { gross: 699, earningAmount: 30_000, capped: false } })
		expect(computeNetInterest(fcm, 8_000)).toMatchObject({ result: { gross: 214.4 } })
	})

	it("subtracts an explicit monthly plan fee only where the notes state it", () => {
		expect(parseFlatMonthlyFee(row("activobank-poupeup-premium").notes)).toBe(8.99)
		expect(parseFlatMonthlyFee(row("bankinter-conta-online").notes)).toBeNull()
		const projection = projectRow(row("activobank-poupeup-premium"), 10_000)
		// 275 gross, 77 tax, 107.88 fees
		expect(projection?.single).toMatchObject({ gross: 275, tax: 77, fees: 107.88, net: 90.12 })
	})

	it("never collapses a rate range into one number and computes each plan from its note", () => {
		expect(parseRatePlans(row("klarna-conta-flex").notes).map((plan) => [plan.name, plan.ratePct, plan.monthlyFee])).toEqual([
			["Standard", 2.2, 0],
			["Core", 2.2, 1.99],
			["Plus", 2.3, 7.99],
			["Premium", 2.4, 14.99],
			["Max", 2.7, 34.99],
		])
		const revolut = projectRow(row("revolut-poupanca-acesso-imediato"), 10_000)
		expect(revolut?.single).toBeNull()
		expect(revolut?.plans).toHaveLength(5)
		// Standard: 150 gross - 42 tax - 0 fees
		expect(revolut?.plans[0].result.net).toBe(108)
		// Ultra: 275 - 77 - 600
		expect(revolut?.plans[4].result.net).toBe(-402)
		expect(revolut?.netLow).toBe(-402)
		expect(revolut?.netHigh).toBe(108)
		// Interest is capped at 100 000 for every plan.
		expect(projectRow(row("revolut-poupanca-acesso-imediato"), 200_000)?.plans[0].result.earningAmount).toBe(100_000)
	})

	it("gives a sensible result or a clear error for zero, empty and very large amounts", () => {
		expect(computeNetInterest(row("bankinter-conta-online"), 0)).toMatchObject({ result: { gross: 0, net: 0 } })
		expect(computeNetInterest(row("bankinter-conta-online"), Number.NaN)).toEqual({ ok: false, error: "required" })
		expect(computeNetInterest(row("bankinter-conta-online"), -1)).toEqual({ ok: false, error: "negative" })
		expect(computeNetInterest(row("bankinter-conta-online"), 1e12)).toEqual({ ok: false, error: "tooLarge" })
		const uncapped: RemuneratedAccount = row("openbank-conta-poupanca-ordenado")
		expect(computeNetInterest(uncapped, 5_000_000)).toMatchObject({ result: { gross: 100_000, capped: false } })
	})

	it("sorts by net interest using the best outcome of each row", () => {
		const projections = REMUNERATED_ACCOUNTS.map((account) => projectRow(account, 10_000)).filter(
			(projection): projection is NonNullable<typeof projection> => projection !== null,
		)
		const sorted = sortRemuneratedAccounts(projections, "netDesc")
		expect(sorted[0].account.id).toBe("bankinter-conta-mais-ordenado")
	})
})

import { describe, expect, it } from "vitest"

import { formatMoney, formatPercent, toIntlLocale } from "./numberFormat"

// Intl separates with no-break spaces; compare on plain spaces.
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ")

describe("numberFormat", () => {
	it("formats euros the Portuguese way on the pt site, not the Brazilian one", () => {
		expect(plain(formatMoney("pt", 2450, { decimals: 2 }))).toBe("2450,00 €")
		expect(plain(formatMoney("pt", 10880, { decimals: 2 }))).toBe("10 880,00 €")
	})

	it("keeps the sign of a loss and can mark a gain", () => {
		expect(plain(formatMoney("pt", -320, { decimals: 2 }))).toBe("-320,00 €")
		expect(plain(formatMoney("en", 1840, { decimals: 2, sign: "always" }))).toBe("+€1,840.00")
	})

	it("formats percentages in percent units with the locale's decimal mark", () => {
		expect(plain(formatPercent("pt", 12.4, { sign: "always" }))).toBe("+12,4%")
		expect(plain(formatPercent("de", 35, { decimals: 0 }))).toBe("35 %")
	})

	it("gives the calculators Portugal's currency format for a whole-euro figure", () => {
		const eur = new Intl.NumberFormat(toIntlLocale("pt"), { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
		expect(plain(eur.format(250000))).toBe("250 000 €")
	})
})

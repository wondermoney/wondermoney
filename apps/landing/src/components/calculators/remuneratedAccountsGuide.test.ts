import { describe, expect, it } from "vitest"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { buildRemuneratedAccountsGuide, remuneratedAccountsExample } from "./remuneratedAccountsGuide"

const { plain, standard, ultra } = remuneratedAccountsExample()

describe("remunerated accounts guide content", () => {
	it.each(SUPPORTED_LANGS)("takes the example's figures from the table's own computation in %s", (lang) => {
		const guide = buildRemuneratedAccountsGuide(lang)
		const eur = (value: number) => formatMoney(lang, value, { currency: "EUR", decimals: 2 })

		expect(guide.flowOperators).toHaveLength(guide.flow.length - 1)
		expect(guide.flow.map((figure) => figure.value)).toEqual([eur(plain.gross), eur(plain.tax), eur(plain.net)])
		expect(guide.plans.map((figure) => figure.value)).toEqual([eur(standard.result.net), eur(ultra.result.net)])
		expect(guide.plans.map((figure) => figure.label)).toEqual([standard.plan.name, ultra.plan.name])
		for (const figure of [...guide.flow, ...guide.plans]) {
			expect(figure.label.trim()).not.toBe("")
			expect(figure.label).not.toMatch(/\{\{/)
		}
		// No fees on the plain account: gross − IRS is the net.
		expect(Math.round((plain.gross - plain.tax) * 100) / 100).toBe(plain.net)
	})
})

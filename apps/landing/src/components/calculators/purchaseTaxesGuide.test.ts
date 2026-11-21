import { describe, expect, it } from "vitest"
import { PURCHASE_TAXES_EXAMPLE, computePurchaseTaxes, imtBands } from "@/lib/calculators/purchaseTaxes"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { formulaHrefs } from "./guideBlocks"
import { expectFigures, expectFormulaLinks, expectTerms } from "./guideTestUtils"
import { PURCHASE_TAXES_GUIDE_IDS, buildPurchaseTaxesGuide } from "./purchaseTaxesGuide"

const calculation = computePurchaseTaxes(PURCHASE_TAXES_EXAMPLE)
if (!calculation.ok) throw new Error("invalid example")
const result = calculation.result

describe("IMT and stamp duty guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every term, figure and formula in %s", (lang) => {
		const guide = buildPurchaseTaxesGuide(lang)
		// The formulas link to the notes and to the IMT table, which carries its own id.
		const table = { term: "table", body: "table", id: PURCHASE_TAXES_GUIDE_IDS.table }
		expectTerms([...guide.notes, ...guide.assumptions, table])
		expectFigures(guide.taxes)
		expectFormulaLinks(guide.formulas, [...guide.notes, ...guide.assumptions, table])
		expect(formulaHrefs(guide.formulas)).toContain(`#${PURCHASE_TAXES_GUIDE_IDS.table}`)
	})

	it("keeps the same note ids in every locale", () => {
		const idsOf = (lang: (typeof SUPPORTED_LANGS)[number]) => {
			const guide = buildPurchaseTaxesGuide(lang)
			return [...guide.notes, ...guide.assumptions].map((note) => note.id)
		}
		const reference = idsOf("en")
		expect(new Set(reference).size).toBe(reference.length)
		for (const lang of SUPPORTED_LANGS) expect(idsOf(lang)).toEqual(reference)
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures and the table from the calculator in %s", (lang) => {
		const guide = buildPurchaseTaxesGuide(lang)
		const money = (value: number) => formatMoney(lang, value, { decimals: 2 })

		expect(guide.taxes.map((figure) => figure.value)).toEqual(
			[result.imt, result.stampPurchase, result.stampLoan, result.total].map(money),
		)
		expect(guide.rows).toHaveLength(imtBands("ownPermanent", "mainland").length)
	})

	it("adds the three taxes up to the total", () => {
		const cents = (value: number) => Math.round(value * 100)
		expect(cents(result.imt) + cents(result.stampPurchase) + cents(result.stampLoan)).toBe(cents(result.total))
	})
})

import { describe, expect, it } from "vitest"
import { BORROWING_CAPACITY_EXAMPLE, computeBorrowingCapacity } from "@/lib/calculators/borrowingCapacity"
import { formatMoney } from "@/lib/numberFormat"
import { SUPPORTED_LANGS } from "@/lib/routes"
import { formulaHrefs } from "./guideBlocks"
import { BORROWING_CAPACITY_GUIDE_IDS, buildBorrowingCapacityGuide } from "./borrowingCapacityGuide"
import { expectGuideParts, expectStableIds } from "./guideTestKit"

const calculation = computeBorrowingCapacity(BORROWING_CAPACITY_EXAMPLE)
if (!calculation.ok || calculation.result.status !== "ok") throw new Error("invalid example")
const result = calculation.result

describe("borrowing capacity guide content", () => {
	it.each(SUPPORTED_LANGS)("builds every term, figure and formula in %s", (lang) => {
		const guide = buildBorrowingCapacityGuide(lang)
		expectGuideParts({
			terms: [...guide.steps, ...guide.notes, ...guide.assumptions, ...guide.lenderRules],
			figures: [...guide.limits, ...guide.purchase],
			formulas: guide.formulas,
		})
		expect(guide.formulas).toHaveLength(5)
		expect(formulaHrefs(guide.formulas).length).toBeGreaterThanOrEqual(15)
	})

	it("keeps the same note ids in every locale", () => {
		expectStableIds((lang) => {
			const guide = buildBorrowingCapacityGuide(lang)
			return [...guide.notes, ...guide.assumptions].map((note) => note.id)
		}, "borrowing-capacity")
		const ids = [...buildBorrowingCapacityGuide("en").notes, ...buildBorrowingCapacityGuide("en").assumptions].map(
			(note) => note.id,
		)
		expect(ids).toEqual(expect.arrayContaining(Object.values(BORROWING_CAPACITY_GUIDE_IDS)))
	})

	it.each(SUPPORTED_LANGS)("takes the example's figures from the calculator in %s", (lang) => {
		const guide = buildBorrowingCapacityGuide(lang)
		const money = (value: number) => formatMoney(lang, value, { decimals: 2 })

		expect(guide.limits.map((figure) => figure.value)).toEqual([
			money(result.monthly.priceCeiling),
			money(result.cash.priceCeiling ?? 0),
			money(result.price),
		])
		expect(guide.purchase.map((figure) => figure.value)).toEqual([
			money(result.loan),
			money(result.downPayment),
			money(result.price),
		])
	})

	it("matches the story: the monthly budget is the lower limit, and loan plus down payment is the price", () => {
		expect(result.binding).toBe("monthly")
		expect(result.price).toBe(Math.min(result.monthly.priceCeiling, result.cash.priceCeiling ?? Infinity))
		expect(Math.round((result.loan + result.downPayment) * 100)).toBe(Math.round(result.price * 100))
	})
})

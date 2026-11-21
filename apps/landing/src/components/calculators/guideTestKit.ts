/**
 * Shared checks for a calculator guide's content builder (`build<Tool>Guide`), used by the
 * guides' tests: every term and figure is filled in each locale, every formula link lands on a
 * note on the page, and the notes keep the same English ids in every locale.
 */
import { expect } from "vitest"
import { SUPPORTED_LANGS, type Lang } from "@/lib/routes"
import { formulaHrefs, type GuideFigure, type GuideFormulaLine, type GuideTerm } from "./guideBlocks"

export type GuideParts = {
	terms: GuideTerm[]
	figures: GuideFigure[]
	formulas: GuideFormulaLine[]
}

/** Checks one locale's parts: no empty or uninterpolated text, links that land on a term. */
export function expectGuideParts({ terms, figures, formulas }: GuideParts) {
	for (const entry of terms) {
		expect(entry.term.trim()).not.toBe("")
		expect(entry.body.trim()).not.toBe("")
		expect(`${entry.term} ${entry.body}`).not.toMatch(/\{\{|\}\}/)
		// The term is its own key, not the start of the body.
		expect(entry.body.startsWith(`${entry.term}:`)).toBe(false)
	}
	for (const figure of figures) {
		expect(figure.label.trim()).not.toBe("")
		expect(figure.value.trim()).not.toBe("")
		expect(figure.label).not.toMatch(/\{\{/)
	}
	const ids = new Set(terms.map((entry) => entry.id).filter(Boolean))
	for (const href of formulaHrefs(formulas)) {
		expect(href.startsWith("#")).toBe(true)
		expect(ids.has(href.slice(1)), href).toBe(true)
	}
}

/** The ids of a guide's linkable terms are unique, prefixed and the same in every locale. */
export function expectStableIds(idsOf: (lang: Lang) => Array<string | undefined>, prefix: string) {
	const reference = idsOf("en").filter((id): id is string => Boolean(id))
	expect(new Set(reference).size).toBe(reference.length)
	for (const id of reference) expect(id.startsWith(`${prefix}-`)).toBe(true)
	for (const lang of SUPPORTED_LANGS) expect(idsOf(lang).filter(Boolean)).toEqual(reference)
}

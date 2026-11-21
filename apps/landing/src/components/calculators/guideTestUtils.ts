/**
 * Checks shared by the calculator guides' content tests (`*Guide.test.ts`): every term and
 * note has a term and a body, every formula link lands on a note of the same guide, and the
 * notes keep the same ids in every locale.
 */
import { expect } from "vitest"
import { SUPPORTED_LANGS, type Lang } from "@/lib/routes"
import { formulaHrefs, type GuideFigure, type GuideFormulaLine, type GuideTerm } from "./guideBlocks"

/** Each entry has a term and a body, and the body no longer starts with "Term:". */
export function expectTerms(entries: ReadonlyArray<GuideTerm>): void {
	expect(entries.length).toBeGreaterThan(0)
	for (const entry of entries) {
		expect(entry.term.trim()).not.toBe("")
		expect(entry.body.trim()).not.toBe("")
		expect(entry.body).not.toMatch(/\{\{/)
		expect(entry.body.startsWith(`${entry.term}:`)).toBe(false)
	}
}

/** Each worked-example figure has a label and a value, with nothing left to interpolate. */
export function expectFigures(figures: ReadonlyArray<GuideFigure>): void {
	expect(figures.length).toBeGreaterThan(0)
	for (const figure of figures) {
		expect(figure.label.trim()).not.toBe("")
		expect(figure.value.trim()).not.toBe("")
		expect(`${figure.label} ${figure.value}`).not.toMatch(/\{\{/)
	}
}

/** Every variable of the formulas links to one of `notes`, and returns the links. */
export function expectFormulaLinks(formulas: ReadonlyArray<GuideFormulaLine>, notes: ReadonlyArray<GuideTerm>): string[] {
	const ids = new Set(notes.map((entry) => entry.id))
	const hrefs = formulaHrefs(formulas)
	expect(hrefs.length).toBeGreaterThan(0)
	for (const href of hrefs) {
		expect(href.startsWith("#")).toBe(true)
		expect(ids.has(href.slice(1))).toBe(true)
	}
	return hrefs
}

/** The ids of `notesOf(lang)` are unique, start with `prefix` and match in every locale. */
export function expectStableIds(notesOf: (lang: Lang) => ReadonlyArray<GuideTerm>, prefix: string): void {
	const reference = notesOf("en").map((entry) => entry.id)
	expect(new Set(reference).size).toBe(reference.length)
	for (const id of reference) expect(id).toMatch(new RegExp(`^${prefix}-[a-z0-9-]+$`))
	for (const lang of SUPPORTED_LANGS) expect(notesOf(lang).map((entry) => entry.id)).toEqual(reference)
}

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { getToolStaticPaths } from "../pageStaticPaths"
import { SUPPORTED_LANGS, resolveToolRouteIdFromLegacy, toLocalizedPath } from "../routes"

// pageStaticPaths imports the Sanity client for the content routes; tool paths never call it.
vi.mock("sanity:client", () => ({ sanityClient: { fetch: vi.fn() } }))

type ToolCopy = Record<string, unknown> & { guide: Record<string, string> }

function readLocale(base: "src/locales" | "public/locales", lang: string) {
	const path = fileURLToPath(new URL(`../../../${base}/${lang}/common.json`, import.meta.url))
	return JSON.parse(readFileSync(path, "utf8")) as { tools: Record<string, ToolCopy> }
}

function readSource(relative: string) {
	return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")
}

function keyPaths(value: unknown, prefix = ""): string[] {
	if (typeof value !== "object" || value === null) return [prefix]
	return Object.entries(value).flatMap(([key, child]) =>
		keyPaths(child, prefix ? `${prefix}.${key}` : key),
	)
}

/** The `{{name}}` placeholders in a string, sorted. */
function placeholders(text: unknown): string[] {
	return [...String(text).matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort()
}

describe("compound interest tool page", () => {
	it("keeps its localized slugs in every locale", () => {
		expect(SUPPORTED_LANGS.map((lang) => toLocalizedPath("toolCompoundInterest", lang))).toEqual([
			"/pt/tools/juros-compostos",
			"/en/tools/compound-interest-calculator",
			"/es/tools/interes-compuesto",
			"/fr/tools/interets-composes",
			"/de/tools/zinseszins-rechner",
			"/it/tools/interesse-composto",
		])
		expect(resolveToolRouteIdFromLegacy("juros-compostos", "en")).toBe("toolCompoundInterest")
	})

	it("is prerendered from the tool static paths in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const pages = getToolStaticPaths(lang).filter(
				(path) => path.props.routeId === "toolCompoundInterest" && !path.props.redirectTo,
			)
			expect(pages).toHaveLength(1)
		}
	})

	it("renders the guide and names the goal as the closing next step", () => {
		const page = readSource("../../components/pages/ToolDetailPage.astro")

		expect(page).toContain('routeId === "toolCompoundInterest" && <CompoundInterestGuide')
		expect(page).toContain('headline: t("tools.compoundInterest.nextStepHeadline")')
		expect(readLocale("src/locales", "en").tools.compoundInterest.nextStepHeadline).toBe(
			"Turn this projection into a tracked goal",
		)
	})

	it("reports use as tool_used without any amounts", () => {
		const calculator = readSource("../../components/calculators/CompoundInterestCalculatorComp.tsx")
		const events = [...calculator.matchAll(/pushGtmEvent\((\{[^}]*\})\)/g)].map((match) => match[1])

		expect(events).toEqual([
			'{ event: "tool_used", tool: "compound_interest", page_type: getPageType() }',
		])
	})

	it("has the same copy keys and placeholders in every locale and in the public mirror", () => {
		const reference = readLocale("src/locales", "en").tools.compoundInterest
		const referenceKeys = keyPaths(reference).sort()

		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.compoundInterest
			expect(keyPaths(copy).sort()).toEqual(referenceKeys)
			for (const key of referenceKeys) {
				const pick = (source: unknown) =>
					key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], source)
				expect(placeholders(pick(copy)), `${lang} ${key}`).toEqual(placeholders(pick(reference)))
			}
			expect(readLocale("public/locales", lang).tools.compoundInterest).toEqual(copy)
		}
	})

	it("has a unique title and meta description per locale", () => {
		const copies = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).tools.compoundInterest)

		expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("addresses the pt reader as tu", () => {
		const pt = JSON.stringify(readLocale("src/locales", "pt").tools.compoundInterest)

		expect(pt).not.toMatch(/\bvocê\b|\bseu\b|\bsua\b|\bseus\b|\bsuas\b/iu)
	})
})

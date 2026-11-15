import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { getToolStaticPaths } from "../pageStaticPaths"
import {
	SUPPORTED_LANGS,
	resolveToolRouteId,
	resolveToolRouteIdFromLegacy,
	toLocalizedPath,
	toLocalizedPathname,
} from "../routes"

// pageStaticPaths imports the Sanity client for the content routes; tool paths never call it.
vi.mock("sanity:client", () => ({ sanityClient: { fetch: vi.fn() } }))

function readLocale(base: "src/locales" | "public/locales", lang: string) {
	const path = fileURLToPath(new URL(`../../../${base}/${lang}/common.json`, import.meta.url))
	return JSON.parse(readFileSync(path, "utf8")) as {
		tools: Record<string, Record<string, unknown>>
	}
}

function keyPaths(value: unknown, prefix = ""): string[] {
	if (typeof value !== "object" || value === null) return [prefix]
	return Object.entries(value).flatMap(([key, child]) =>
		keyPaths(child, prefix ? `${prefix}.${key}` : key),
	)
}

describe("debt-to-income tool page", () => {
	it("has a localized tool route in every locale", () => {
		const paths = SUPPORTED_LANGS.map((lang) => toLocalizedPath("toolDebtToIncome", lang))

		expect(paths).toEqual([
			"/pt/tools/taxa-de-esforco",
			"/en/tools/debt-to-income-calculator",
			"/es/tools/ratio-endeudamiento",
			"/fr/tools/taux-endettement",
			"/de/tools/schuldendienstquote-rechner",
			"/it/tools/rapporto-rata-reddito",
		])
		for (const lang of SUPPORTED_LANGS) {
			const slug = toLocalizedPath("toolDebtToIncome", lang).split("/").pop() as string
			expect(resolveToolRouteId(lang, slug)).toBe("toolDebtToIncome")
		}
	})

	it("is prerendered from the tool static paths in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const pages = getToolStaticPaths(lang).filter(
				(path) => path.props.routeId === "toolDebtToIncome",
			)
			// One page per locale and no legacy redirect page: the tool never had another address.
			expect(pages).toHaveLength(1)
			expect(pages[0].props.redirectTo).toBeUndefined()
			expect(pages[0].params.tool).toBe(
				toLocalizedPath("toolDebtToIncome", lang).split("/").pop(),
			)
		}
	})

	it("keeps the slug when switching language", () => {
		expect(toLocalizedPathname("/pt/tools/taxa-de-esforco", "fr")).toBe(
			"/fr/tools/taux-endettement",
		)
	})

	it("can be linked from learn and glossary content", () => {
		expect(resolveToolRouteIdFromLegacy("taxa-de-esforco", "en")).toBe("toolDebtToIncome")
		expect(resolveToolRouteIdFromLegacy("debtToIncomeCalculator", "pt")).toBe("toolDebtToIncome")
	})

	it("is listed on the tools hub in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const hub = readFileSync(
				fileURLToPath(new URL(`../../pages/${lang}/tools/index.astro`, import.meta.url)),
				"utf8",
			)
			expect(hub).toContain('routeId: "toolDebtToIncome"')
		}
	})

	it("has the same copy keys in every locale and in the public mirror", () => {
		const reference = keyPaths(readLocale("src/locales", "en").tools.debtToIncome).sort()

		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.debtToIncome
			expect(keyPaths(copy).sort()).toEqual(reference)
			expect(readLocale("public/locales", lang).tools.debtToIncome).toEqual(copy)
		}
	})

	it("has a unique title and meta description per locale", () => {
		const copies = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).tools.debtToIncome)

		expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("addresses the pt reader as tu", () => {
		const pt = JSON.stringify(readLocale("src/locales", "pt").tools.debtToIncome)

		expect(pt).not.toMatch(/\bvocê\b|\bseu\b|\bsua\b/iu)
	})
})

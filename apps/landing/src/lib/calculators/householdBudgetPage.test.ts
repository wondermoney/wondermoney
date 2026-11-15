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
import { buildToolsHub } from "../toolsCatalog"
import { BUDGET_CATEGORIES, HOUSEHOLD_BUDGET_WORKED_EXAMPLE } from "./householdBudget"

// pageStaticPaths imports the Sanity client for the content routes; tool paths never call it.
vi.mock("sanity:client", () => ({ sanityClient: { fetch: vi.fn() } }))

type ToolCopy = Record<string, unknown> & {
	categories: Record<string, string>
	incomeRows: Record<string, string>
	expenseRows: Record<string, string>
}

function readLocale(base: "src/locales" | "public/locales", lang: string) {
	const path = fileURLToPath(new URL(`../../../${base}/${lang}/common.json`, import.meta.url))
	return JSON.parse(readFileSync(path, "utf8")) as {
		tools: Record<string, ToolCopy>
	}
}

function readSource(relativePath: string) {
	return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
}

function keyPaths(value: unknown, prefix = ""): string[] {
	if (typeof value !== "object" || value === null) return [prefix]
	return Object.entries(value).flatMap(([key, child]) =>
		keyPaths(child, prefix ? `${prefix}.${key}` : key),
	)
}

describe("household budget tool page", () => {
	it("has a localized tool route in every locale", () => {
		const paths = SUPPORTED_LANGS.map((lang) => toLocalizedPath("toolHouseholdBudget", lang))

		expect(paths).toEqual([
			"/pt/tools/orcamento-familiar",
			"/en/tools/household-budget-calculator",
			"/es/tools/presupuesto-familiar",
			"/fr/tools/budget-familial",
			"/de/tools/haushaltsbudget-rechner",
			"/it/tools/budget-familiare",
		])
		for (const lang of SUPPORTED_LANGS) {
			const slug = toLocalizedPath("toolHouseholdBudget", lang).split("/").pop() as string
			expect(resolveToolRouteId(lang, slug)).toBe("toolHouseholdBudget")
		}
	})

	it("is prerendered from the tool static paths in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const pages = getToolStaticPaths(lang).filter(
				(path) => path.props.routeId === "toolHouseholdBudget",
			)
			// One page per locale and no legacy redirect page: the tool never had another address.
			expect(pages).toHaveLength(1)
			expect(pages[0].props.redirectTo).toBeUndefined()
			expect(pages[0].params.tool).toBe(
				toLocalizedPath("toolHouseholdBudget", lang).split("/").pop(),
			)
		}
	})

	it("keeps the slug when switching language", () => {
		expect(toLocalizedPathname("/pt/tools/orcamento-familiar", "de")).toBe(
			"/de/tools/haushaltsbudget-rechner",
		)
	})

	it("can be linked from learn and glossary content", () => {
		expect(resolveToolRouteIdFromLegacy("orcamento-familiar", "en")).toBe("toolHouseholdBudget")
		expect(resolveToolRouteIdFromLegacy("householdBudgetCalculator", "pt")).toBe(
			"toolHouseholdBudget",
		)
	})

	it("is listed on the tools hub in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const hubTools = buildToolsHub(lang).flatMap((group) => group.tools)
			expect(hubTools.map((tool) => tool.href)).toContain(toLocalizedPath("toolHouseholdBudget", lang))
		}
	})

	it("has the same copy keys in every locale and in the public mirror", () => {
		const reference = keyPaths(readLocale("src/locales", "en").tools.householdBudget).sort()

		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.householdBudget
			expect(keyPaths(copy).sort()).toEqual(reference)
			expect(readLocale("public/locales", lang).tools.householdBudget).toEqual(copy)
		}
	})

	it("names every category and every example row in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.householdBudget
			expect(Object.keys(copy.categories).sort()).toEqual([...BUDGET_CATEGORIES].sort())
			for (const row of HOUSEHOLD_BUDGET_WORKED_EXAMPLE.incomes) {
				expect(copy.incomeRows[row.id]).toBeTruthy()
			}
			for (const row of HOUSEHOLD_BUDGET_WORKED_EXAMPLE.expenses) {
				expect(copy.expenseRows[row.id]).toBeTruthy()
			}
		}
	})

	it("has a unique title and meta description per locale", () => {
		const copies = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).tools.householdBudget)

		expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("addresses the pt reader as tu", () => {
		const pt = JSON.stringify(readLocale("src/locales", "pt").tools.householdBudget)

		// \b is ASCII-only, so it never matches next to "ê": use letter lookarounds.
		expect(pt).not.toMatch(/(?<!\p{L})(?:você|seu|sua|seus|suas)(?!\p{L})/iu)
	})

	it("reports use without amounts and stores nothing in the browser", () => {
		const source = readSource("../../components/calculators/HouseholdBudgetCalculatorComp.tsx")

		expect(source).toContain(
			'pushGtmEvent({ event: "tool_used", tool: "household_budget", page_type: getPageType() })',
		)
		expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/)
	})
})

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
import { buildToolsHub, getToolCatalogEntry, toolAnalyticsName } from "../toolsCatalog"

// pageStaticPaths imports the Sanity client for the content routes; tool paths never call it.
vi.mock("sanity:client", () => ({ sanityClient: { fetch: vi.fn() } }))

type ToolCopy = Record<string, unknown> & {
	pageTitle: string
	pageDescription: string
	cta: { headline: string }
}

function readLocale(base: "src/locales" | "public/locales", lang: string) {
	const path = fileURLToPath(new URL(`../../../${base}/${lang}/common.json`, import.meta.url))
	return JSON.parse(readFileSync(path, "utf8")) as { tools: Record<string, ToolCopy> }
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

describe("mortgage transfer tool page", () => {
	it("has a localized tool route in every locale", () => {
		const paths = SUPPORTED_LANGS.map((lang) => toLocalizedPath("toolMortgageTransfer", lang))

		expect(paths).toEqual([
			"/pt/tools/simulador-transferencia-credito-habitacao",
			"/en/tools/mortgage-switch-calculator",
			"/es/tools/cambiar-hipoteca-de-banco",
			"/fr/tools/rachat-credit-immobilier",
			"/de/tools/umschuldung-rechner",
			"/it/tools/surroga-mutuo",
		])
		for (const lang of SUPPORTED_LANGS) {
			const slug = toLocalizedPath("toolMortgageTransfer", lang).split("/").pop() as string
			expect(resolveToolRouteId(lang, slug)).toBe("toolMortgageTransfer")
		}
	})

	it("is prerendered from the tool static paths in every locale, with no legacy slug", () => {
		for (const lang of SUPPORTED_LANGS) {
			const pages = getToolStaticPaths(lang).filter(
				(path) => path.props.routeId === "toolMortgageTransfer",
			)
			expect(pages).toHaveLength(1)
			expect(pages[0].props.redirectTo).toBeUndefined()
			expect(pages[0].params.tool).toBe(
				toLocalizedPath("toolMortgageTransfer", lang).split("/").pop(),
			)
		}
	})

	it("keeps the slug when switching language", () => {
		expect(toLocalizedPathname("/pt/tools/simulador-transferencia-credito-habitacao", "it")).toBe(
			"/it/tools/surroga-mutuo",
		)
	})

	it("can be linked from learn and glossary content", () => {
		expect(resolveToolRouteIdFromLegacy("simulador-transferencia-credito-habitacao", "en")).toBe(
			"toolMortgageTransfer",
		)
		expect(resolveToolRouteIdFromLegacy("mortgageTransferCalculator", "pt")).toBe(
			"toolMortgageTransfer",
		)
	})

	it("is listed on the tools hub in every locale, after early repayment", () => {
		for (const lang of SUPPORTED_LANGS) {
			const group = buildToolsHub(lang).find((entry) => entry.id === "borrowAndBuyHome")
			const routeIds = group?.tools.map((tool) => tool.routeId) ?? []
			expect(routeIds).toContain("toolMortgageTransfer")
			expect(routeIds.indexOf("toolMortgageTransfer")).toBe(routeIds.indexOf("toolEarlyRepayment") + 1)
			expect(group?.tools.find((tool) => tool.routeId === "toolMortgageTransfer")?.href).toBe(
				toLocalizedPath("toolMortgageTransfer", lang),
			)
		}
	})

	it("links its guide to the mortgage, early repayment and debt-to-income tools", () => {
		const guide = readSource("../../components/calculators/MortgageTransferGuide.astro")
		expect(guide).toContain('toLocalizedPath("toolMortgage", locale)')
		expect(guide).toContain('toLocalizedPath("toolEarlyRepayment", locale)')
		expect(guide).toContain('toLocalizedPath("toolDebtToIncome", locale)')

		expect(getToolCatalogEntry("toolMortgageTransfer").related).toEqual([
			"toolMortgage",
			"toolEarlyRepayment",
			"toolDebtToIncome",
		])
	})

	it("has the same copy keys in every locale and in the public mirror", () => {
		const reference = keyPaths(readLocale("src/locales", "en").tools.mortgageTransfer).sort()

		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.mortgageTransfer
			expect(keyPaths(copy).sort()).toEqual(reference)
			expect(readLocale("public/locales", lang).tools.mortgageTransfer).toEqual(copy)
		}
	})

	it("has a short name for the menus, and a unique title and meta description per locale", () => {
		const copies = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).tools.mortgageTransfer)

		for (const copy of copies) expect(copy.shortName).toEqual(expect.stringMatching(/\S/))
		expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("offers comparing loan offers as the next step", () => {
		expect(readLocale("src/locales", "en").tools.mortgageTransfer.cta.headline).toBe(
			"Compare your loan offers in one place",
		)
		expect(readSource("../../components/pages/ToolDetailPage.astro")).toContain(
			't("tools.mortgageTransfer.cta.headline")',
		)
	})

	it("says the costs vary and variable rates are out of scope, in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.mortgageTransfer as ToolCopy & {
				costs: { help: string }
				guide: { method: { assumptions: { fixedRate: string } } }
			}
			expect(copy.costs.help, lang).toMatch(/\S/)
			expect(copy.guide.method.assumptions.fixedRate, lang).toMatch(/\S/)
		}
		const en = readLocale("src/locales", "en").tools.mortgageTransfer as ToolCopy & {
			costs: { help: string }
			guide: { method: { assumptions: { fixedRate: string } } }
		}
		expect(en.costs.help).toContain("vary by country")
		expect(en.guide.method.assumptions.fixedRate).toContain("Variable and mixed rates")
	})

	it("addresses the pt reader as tu", () => {
		const pt = JSON.stringify(readLocale("src/locales", "pt").tools.mortgageTransfer)

		// \b is ASCII-only, so it never matches next to "ê": use letter lookarounds.
		expect(pt).not.toMatch(/(?<!\p{L})(?:você|seu|sua|seus|suas)(?!\p{L})/iu)
	})

	it("reports use without amounts and stores nothing in the browser", () => {
		const source = readSource("../../components/calculators/MortgageTransferCalculatorComp.tsx")

		expect(source).toContain(
			'pushGtmEvent({ event: "tool_used", tool: "mortgage_transfer", page_type: getPageType() })',
		)
		expect(toolAnalyticsName("mortgageTransfer")).toBe("mortgage_transfer")
		expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/)
	})
})

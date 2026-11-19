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
import { getRelatedContentTools } from "../relatedContentTools"
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

describe("S&P 500 historical returns tool page", () => {
	it("has a localized tool route in every locale", () => {
		const paths = SUPPORTED_LANGS.map((lang) => toLocalizedPath("toolSp500History", lang))

		expect(paths).toEqual([
			"/pt/tools/rentabilidade-sp500-historica",
			"/en/tools/sp500-historical-returns-calculator",
			"/es/tools/rentabilidad-historica-sp500",
			"/fr/tools/rendement-historique-sp500",
			"/de/tools/sp500-historische-rendite-rechner",
			"/it/tools/rendimento-storico-sp500",
		])
		for (const lang of SUPPORTED_LANGS) {
			const slug = toLocalizedPath("toolSp500History", lang).split("/").pop() as string
			expect(resolveToolRouteId(lang, slug)).toBe("toolSp500History")
		}
	})

	it("is prerendered from the tool static paths in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const pages = getToolStaticPaths(lang).filter((path) => path.props.routeId === "toolSp500History")
			expect(pages).toHaveLength(1)
			expect(pages[0].params.tool).toBe(toLocalizedPath("toolSp500History", lang).split("/").pop())
		}
	})

	it("keeps the slug when switching language", () => {
		expect(toLocalizedPathname("/pt/tools/rentabilidade-sp500-historica", "de")).toBe(
			"/de/tools/sp500-historische-rendite-rechner",
		)
	})

	it("can be linked from learn and glossary content", () => {
		expect(resolveToolRouteIdFromLegacy("sp500-historical-returns", "en")).toBe("toolSp500History")
		expect(
			getRelatedContentTools([{ href: toLocalizedPath("toolInvestmentReturn", "en") }], "en", () => "x").map(
				(item) => item.href,
			),
		).toContain(toLocalizedPath("toolSp500History", "en"))
	})

	it("is listed on the tools hub in every locale, in the investing group", () => {
		for (const lang of SUPPORTED_LANGS) {
			const hub = buildToolsHub(lang)
			expect(hub.flatMap((group) => group.tools).map((tool) => tool.href)).toContain(
				toLocalizedPath("toolSp500History", lang),
			)
			expect(hub.find((group) => group.id === "investAndGrow")?.tools.map((tool) => tool.routeId)).toContain(
				"toolSp500History",
			)
		}
	})

	it("links its guide to the investment return and compound interest tools, and back", () => {
		const guide = readSource("../../components/calculators/Sp500HistoryGuide.astro")
		expect(guide).toContain('toLocalizedPath("toolInvestmentReturn", locale)')
		expect(guide).toContain('toLocalizedPath("toolCompoundInterest", locale)')

		expect(getToolCatalogEntry("toolInvestmentReturn").related).toContain("toolSp500History")
		expect(getToolCatalogEntry("toolSp500History").related).toEqual([
			"toolInvestmentReturn",
			"toolCompoundInterest",
			"toolInvestorProfile",
		])
	})

	it("has the same copy keys in every locale and in the public mirror", () => {
		const reference = keyPaths(readLocale("src/locales", "en").tools.sp500History).sort()

		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.sp500History
			expect(keyPaths(copy).sort()).toEqual(reference)
			expect(readLocale("public/locales", lang).tools.sp500History).toEqual(copy)
		}
	})

	it("has a unique title and meta description per locale", () => {
		const copies = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).tools.sp500History)

		expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("states the source, the currency risk and the past performance caveat in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.sp500History as unknown as {
				sourceNote: string
				currencyNote: string
				result: { pastPerformance: string }
				guide: { data: { source: string }; limits: { items: { fx: string } } }
			}
			expect(copy.sourceNote).toContain("Shiller")
			expect(copy.sourceNote).toContain("{{date}}")
			expect(copy.currencyNote).toMatch(/USD|\$|dollar|Dollar|dólar|dollaro/)
			expect(copy.guide.limits.items.fx).toBeTruthy()
			expect(copy.result.pastPerformance).toBeTruthy()
			expect(copy.guide.data.source).toContain("{{downloaded}}")
		}
	})

	it("offers comparing the scenarios with the portfolio plan as the next step", () => {
		expect(readLocale("src/locales", "en").tools.sp500History.nextStepHeadline).toBe(
			"Compare historical scenarios with your portfolio plan",
		)
		expect(readSource("../../components/pages/ToolDetailPage.astro")).toContain(
			't("tools.sp500History.nextStepHeadline")',
		)
	})

	it("addresses the pt reader as tu", () => {
		const pt = JSON.stringify(readLocale("src/locales", "pt").tools.sp500History)

		// \b is ASCII-only, so it never matches next to "ê": use letter lookarounds.
		expect(pt).not.toMatch(/(?<!\p{L})(?:você|seu|sua|seus|suas)(?!\p{L})/iu)
	})

	it("reports use without inputs or results and stores nothing in the browser", () => {
		const source = readSource("../../components/calculators/Sp500HistoryCalculatorComp.tsx")

		expect(source).toContain(
			'pushGtmEvent({ event: "tool_used", tool: "sp500_history", page_type: getPageType() })',
		)
		expect(toolAnalyticsName("sp500History")).toBe("sp500_history")
		expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/)
	})
})

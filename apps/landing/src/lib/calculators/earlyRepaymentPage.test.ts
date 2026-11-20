import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { getToolStaticPaths } from "../pageStaticPaths"
import {
	SUPPORTED_LANGS,
	resolveToolRouteId,
	resolveToolRouteIdFromLegacy,
	toLocalizedPath,
	toLocalizedPathname,
} from "../routes"
import { buildToolsHub, getToolCatalogEntry, toolAnalyticsName } from "../toolsCatalog"

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

describe("early repayment tool page", () => {
	it("has a localized tool route in every locale", () => {
		const paths = SUPPORTED_LANGS.map((lang) => toLocalizedPath("toolEarlyRepayment", lang))

		expect(paths).toEqual([
			"/pt/tools/simulador-amortizacao-credito",
			"/en/tools/early-repayment-calculator",
			"/es/tools/amortizacion-anticipada",
			"/fr/tools/remboursement-anticipe",
			"/de/tools/sondertilgung-rechner",
			"/it/tools/estinzione-anticipata",
		])
		for (const lang of SUPPORTED_LANGS) {
			const slug = toLocalizedPath("toolEarlyRepayment", lang).split("/").pop() as string
			expect(resolveToolRouteId(lang, slug)).toBe("toolEarlyRepayment")
		}
	})

	it("is prerendered from the tool static paths in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const pages = getToolStaticPaths(lang).filter(
				(path) => path.props.routeId === "toolEarlyRepayment",
			)
			expect(pages).toHaveLength(1)
			expect(pages[0].params.tool).toBe(
				toLocalizedPath("toolEarlyRepayment", lang).split("/").pop(),
			)
		}
	})

	it("keeps the slug when switching language", () => {
		expect(toLocalizedPathname("/pt/tools/simulador-amortizacao-credito", "de")).toBe(
			"/de/tools/sondertilgung-rechner",
		)
	})

	it("can be linked from learn and glossary content", () => {
		expect(resolveToolRouteIdFromLegacy("simulador-amortizacao-credito", "en")).toBe(
			"toolEarlyRepayment",
		)
		expect(resolveToolRouteIdFromLegacy("earlyRepaymentCalculator", "pt")).toBe(
			"toolEarlyRepayment",
		)
	})

	it("is listed on the tools hub in every locale, with the home and borrowing tools", () => {
		for (const lang of SUPPORTED_LANGS) {
			const hub = buildToolsHub(lang)
			const hubTools = hub.flatMap((group) => group.tools)
			expect(hubTools.map((tool) => tool.href)).toContain(toLocalizedPath("toolEarlyRepayment", lang))
			expect(
				hub.find((group) => group.id === "borrowAndBuyHome")?.tools.map((tool) => tool.routeId),
			).toContain("toolEarlyRepayment")
		}
	})

	it("links its guide to the mortgage and debt-to-income tools, and the mortgage page back", () => {
		const guide = readSource("../../components/calculators/EarlyRepaymentGuide.astro")
		expect(guide).toContain('toLocalizedPath("toolMortgage", locale)')
		expect(guide).toContain('toLocalizedPath("toolDebtToIncome", locale)')

		expect(getToolCatalogEntry("toolMortgage").related).toContain("toolEarlyRepayment")
		expect(getToolCatalogEntry("toolEarlyRepayment").related).toEqual([
			"toolMortgage",
			"toolDebtToIncome",
			"toolEmergencyFund",
		])
	})

	it("has the same copy keys in every locale and in the public mirror", () => {
		const reference = keyPaths(readLocale("src/locales", "en").tools.earlyRepayment).sort()

		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.earlyRepayment
			expect(keyPaths(copy).sort()).toEqual(reference)
			expect(readLocale("public/locales", lang).tools.earlyRepayment).toEqual(copy)
		}
	})

	it("has a unique title and meta description per locale", () => {
		const copies = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).tools.earlyRepayment)

		expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("offers tracking the remaining debt as the next step", () => {
		expect(readLocale("src/locales", "en").tools.earlyRepayment.cta.headline).toBe(
			"Track your remaining debt over time",
		)
		expect(readSource("../../components/pages/ToolDetailPage.astro")).toContain(
			't("tools.earlyRepayment.cta.headline")',
		)
	})

	it("addresses the pt reader as tu", () => {
		const pt = JSON.stringify(readLocale("src/locales", "pt").tools.earlyRepayment)

		// \b is ASCII-only, so it never matches next to "ê": use letter lookarounds.
		expect(pt).not.toMatch(/(?<!\p{L})(?:você|seu|sua|seus|suas)(?!\p{L})/iu)
	})

	it("reports use without amounts and stores nothing in the browser", () => {
		const source = readSource("../../components/calculators/EarlyRepaymentCalculatorComp.tsx")

		expect(source).toContain(
			'pushGtmEvent({ event: "tool_used", tool: "early_repayment", page_type: getPageType() })',
		)
		expect(toolAnalyticsName("earlyRepayment")).toBe("early_repayment")
		expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/)
	})
})

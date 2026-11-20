import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { figureForTool } from "../hairline/articleFigures"
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

type Copy = Record<string, unknown> & { pageTitle: string; pageDescription: string; nextStepCta: string }

function readLocale(base: "src/locales" | "public/locales", lang: string) {
	const path = fileURLToPath(new URL(`../../../${base}/${lang}/common.json`, import.meta.url))
	return JSON.parse(readFileSync(path, "utf8")) as { tools: Record<string, Copy> }
}

function readSource(relativePath: string) {
	return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
}

function keyPaths(value: unknown, prefix = ""): string[] {
	if (typeof value !== "object" || value === null) return [prefix]
	return Object.entries(value).flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key))
}

describe("gold price tool page", () => {
	it("has a localized tool route in every locale", () => {
		expect(SUPPORTED_LANGS.map((lang) => toLocalizedPath("toolGoldPrice", lang))).toEqual([
			"/pt/tools/preco-do-ouro",
			"/en/tools/gold-price-per-gram",
			"/es/tools/precio-del-oro-gramo",
			"/fr/tools/prix-or-gramme",
			"/de/tools/goldpreis-pro-gramm",
			"/it/tools/prezzo-oro-grammo",
		])
		for (const lang of SUPPORTED_LANGS) {
			const slug = toLocalizedPath("toolGoldPrice", lang).split("/").pop() as string
			expect(resolveToolRouteId(lang, slug)).toBe("toolGoldPrice")
		}
	})

	it("is prerendered from the tool static paths in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const pages = getToolStaticPaths(lang).filter((path) => path.props.routeId === "toolGoldPrice")
			expect(pages).toHaveLength(1)
			expect(pages[0].params.tool).toBe(toLocalizedPath("toolGoldPrice", lang).split("/").pop())
		}
	})

	it("keeps the slug when switching language and resolves short links", () => {
		expect(toLocalizedPathname("/pt/tools/preco-do-ouro", "en")).toBe("/en/tools/gold-price-per-gram")
		expect(resolveToolRouteIdFromLegacy("gold-price", "en")).toBe("toolGoldPrice")
		expect(resolveToolRouteIdFromLegacy("preco-do-ouro", "de")).toBe("toolGoldPrice")
	})

	it("is listed on the tools hub in every locale, with the net worth tool, and shows the safe", () => {
		for (const lang of SUPPORTED_LANGS) {
			const group = buildToolsHub(lang).find((candidate) => candidate.id === "trackWealth")
			expect(group?.tools.map((tool) => tool.routeId)).toEqual(["toolNetWorth", "toolGoldPrice"])
		}
		expect(toolAnalyticsName("goldPrice")).toBe("gold_price")
		expect(figureForTool("toolGoldPrice")).toBe("safe")
	})

	it("suggests the net worth, inflation and investment return tools and is suggested by them", () => {
		expect(getToolCatalogEntry("toolGoldPrice").related).toEqual(["toolNetWorth", "toolInflation", "toolInvestmentReturn"])
		for (const source of ["toolNetWorth", "toolInflation", "toolInvestmentReturn"] as const) {
			expect(
				getRelatedContentTools([{ href: toLocalizedPath(source, "pt") }], "pt", () => "x").map((item) => item.href),
			).toContain(toLocalizedPath("toolGoldPrice", "pt"))
		}
	})

	it("renders the component and the guide from the tool detail page, with the net worth next step", () => {
		const page = readSource("../../components/pages/ToolDetailPage.astro")
		expect(page).toContain('routeId === "toolGoldPrice" && <GoldPriceComp locale={locale} client:load />')
		expect(page).toContain('routeId === "toolGoldPrice" && <GoldPriceGuide locale={locale} />')
		expect(page).toMatch(/toolGoldPrice: \{[^}]*ctaHref: toLocalizedPath\("featureNetWorth", locale\)/)
		const guide = readSource("../../components/calculators/GoldPriceGuide.astro")
		for (const routeId of ["toolNetWorth", "toolInflation", "toolInvestmentReturn"]) {
			expect(guide).toContain(`toLocalizedPath("${routeId}", locale)`)
		}
	})

	it("has the same copy keys in every locale and in the public mirror", () => {
		const reference = keyPaths(readLocale("src/locales", "en").tools.goldPrice).sort()
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.goldPrice
			expect(keyPaths(copy).sort()).toEqual(reference)
			expect(readLocale("public/locales", lang).tools.goldPrice).toEqual(copy)
		}
	})

	it("has a unique title and meta description per locale", () => {
		const copies = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).tools.goldPrice)
		expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("names NBP and the ECB, dates the price, explains the LBMA choice and that buyers pay less, in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.goldPrice as unknown as {
				latest: { asOf: string; stale: string }
				recent: { asOf: string }
				result: { buyers: string }
				guide: { data: { nbp: string; why: string; ecb: string; refresh: string }; buyers: { below: string } }
			}
			expect(copy.latest.asOf).toContain("{{date}}")
			expect(copy.latest.asOf).toContain("Narodowy Bank Polski")
			expect(copy.latest.stale).toContain("{{days}}")
			expect(copy.recent.asOf).toContain("{{date}}")
			expect(copy.recent.asOf).toContain("{{fetched}}")
			expect(copy.guide.data.nbp).toContain("{{asOf}}")
			expect(copy.guide.data.why).toContain("LBMA")
			expect(copy.guide.data.why).toContain("ICE Benchmark Administration")
			expect(copy.guide.data.refresh).toContain("{{asOf}}")
			expect(copy.result.buyers).toBeTruthy()
			expect(copy.guide.buyers.below).toBeTruthy()
		}
		const en = readLocale("src/locales", "en").tools.goldPrice as unknown as { result: { buyers: string } }
		expect(en.result.buyers).toContain("pay less")
	})

	it("offers net worth as the next step in every locale", () => {
		expect(readLocale("src/locales", "en").tools.goldPrice.nextStepCta).toBe("Include physical assets in your net worth")
		for (const lang of SUPPORTED_LANGS) {
			expect(String(readLocale("src/locales", lang).tools.goldPrice.nextStepCta).length).toBeGreaterThan(10)
		}
	})

	it("addresses the pt reader as tu", () => {
		const pt = JSON.stringify(readLocale("src/locales", "pt").tools.goldPrice)
		expect(pt).not.toMatch(/(?<!\p{L})(?:você|seu|sua|seus|suas)(?!\p{L})/iu)
	})

	it("reports use without inputs or results, stores nothing and never fetches at runtime", () => {
		const source = readSource("../../components/calculators/GoldPriceComp.tsx")
		expect(source).toContain('pushGtmEvent({ event: "tool_used", tool: "gold_price", page_type: getPageType() })')
		expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/)
	})
})

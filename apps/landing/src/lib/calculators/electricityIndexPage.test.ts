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

describe("electricity price index tool page", () => {
	it("has a localized tool route in every locale", () => {
		const paths = SUPPORTED_LANGS.map((lang) => toLocalizedPath("toolElectricityIndex", lang))

		expect(paths).toEqual([
			"/pt/tools/indice-da-eletricidade",
			"/en/tools/electricity-price-index-portugal",
			"/es/tools/indice-precio-electricidad-portugal",
			"/fr/tools/indice-prix-electricite-portugal",
			"/de/tools/strompreisindex-portugal",
			"/it/tools/indice-prezzo-elettricita-portogallo",
		])
		for (const lang of SUPPORTED_LANGS) {
			const slug = toLocalizedPath("toolElectricityIndex", lang).split("/").pop() as string
			expect(resolveToolRouteId(lang, slug)).toBe("toolElectricityIndex")
		}
	})

	it("is prerendered from the tool static paths in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const pages = getToolStaticPaths(lang).filter((path) => path.props.routeId === "toolElectricityIndex")
			expect(pages).toHaveLength(1)
			expect(pages[0].params.tool).toBe(toLocalizedPath("toolElectricityIndex", lang).split("/").pop())
		}
	})

	it("keeps the slug when switching language and resolves legacy links", () => {
		expect(toLocalizedPathname("/pt/tools/indice-da-eletricidade", "de")).toBe(
			"/de/tools/strompreisindex-portugal",
		)
		expect(resolveToolRouteIdFromLegacy("electricity-price-index", "en")).toBe("toolElectricityIndex")
	})

	it("is listed on the tools hub in every locale, in the budget group", () => {
		for (const lang of SUPPORTED_LANGS) {
			const hub = buildToolsHub(lang)
			expect(hub.find((group) => group.id === "budgetAndSave")?.tools.map((tool) => tool.routeId)).toContain(
				"toolElectricityIndex",
			)
		}
		expect(toolAnalyticsName("electricityIndex")).toBe("electricity_index")
	})

	it("is linked from the household budget and emergency fund tools", () => {
		for (const source of ["toolHouseholdBudget", "toolEmergencyFund"] as const) {
			expect(
				getRelatedContentTools([{ href: toLocalizedPath(source, "en") }], "en", () => "x").map((item) => item.href),
			).toContain(toLocalizedPath("toolElectricityIndex", "en"))
			expect(getToolCatalogEntry(source).routeId).toBe(source)
		}
		expect(getToolCatalogEntry("toolElectricityIndex").related).toEqual([
			"toolHouseholdBudget",
			"toolEmergencyFund",
			"toolInflation",
		])
	})

	it("renders the guide and the component from the tool detail page and links the guide onwards", () => {
		const page = readSource("../../components/pages/ToolDetailPage.astro")
		expect(page).toContain('routeId === "toolElectricityIndex" && <ElectricityIndexComp')
		expect(page).toContain('routeId === "toolElectricityIndex" && <ElectricityIndexGuide')
		const guide = readSource("../../components/calculators/ElectricityIndexGuide.astro")
		expect(guide).toContain('toLocalizedPath("toolHouseholdBudget", locale)')
		expect(guide).toContain('toLocalizedPath("toolEmergencyFund", locale)')
	})

	it("has the same copy keys in every locale and in the public mirror", () => {
		const reference = keyPaths(readLocale("src/locales", "en").tools.electricityIndex).sort()

		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.electricityIndex
			expect(keyPaths(copy).sort()).toEqual(reference)
			expect(readLocale("public/locales", lang).tools.electricityIndex).toEqual(copy)
		}
	})

	it("has a unique title and meta description per locale", () => {
		const copies = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).tools.electricityIndex)

		expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("names the official sources, the dates and the free market in every locale, and no supplier", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.electricityIndex as unknown as {
				notes: { tariffs: string; freeMarket: string; simulatorLink: string }
				index: { asOf: string }
				guide: { data: { tariffs: string; eurostat: string } }
			}
			expect(copy.notes.tariffs).toContain("{{date}}")
			expect(copy.notes.tariffs).toContain("ERSE")
			expect(copy.notes.freeMarket).toBeTruthy()
			expect(copy.notes.simulatorLink).toContain("ERSE")
			expect(copy.index.asOf).toContain("{{updated}}")
			expect(copy.index.asOf).toContain("Eurostat")
			expect(copy.guide.data.tariffs).toContain("{{from}}")
			expect(copy.guide.data.eurostat).toContain("{{fetched}}")
			expect(JSON.stringify(copy)).not.toMatch(/\b(EDP|Endesa|Galp|Iberdrola|Goldenergy|SU Eletricidade|Repsol|Axpo)\b/i)
		}
	})

	it("offers a realistic household budget as the next step", () => {
		expect(readLocale("src/locales", "en").tools.electricityIndex.nextStepHeadline).toBe(
			"Compare household bills with a realistic budget",
		)
		expect(readSource("../../components/pages/ToolDetailPage.astro")).toContain(
			't("tools.electricityIndex.nextStepHeadline")',
		)
	})

	it("addresses the pt reader as tu", () => {
		const pt = JSON.stringify(readLocale("src/locales", "pt").tools.electricityIndex)

		expect(pt).not.toMatch(/(?<!\p{L})(?:você|seu|sua|seus|suas)(?!\p{L})/iu)
	})

	it("reports use without inputs or results, stores nothing and never fetches at runtime", () => {
		const source = readSource("../../components/calculators/ElectricityIndexComp.tsx")

		expect(source).toContain(
			'pushGtmEvent({ event: "tool_used", tool: "electricity_index", page_type: getPageType() })',
		)
		expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/)
	})
})

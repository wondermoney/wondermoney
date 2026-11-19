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

describe("deposit rate index tool page", () => {
	it("has a localized tool route in every locale", () => {
		const paths = SUPPORTED_LANGS.map((lang) => toLocalizedPath("toolDepositRateIndex", lang))

		expect(paths).toEqual([
			"/pt/tools/indice-taxas-depositos-a-prazo",
			"/en/tools/term-deposit-rate-index-portugal",
			"/es/tools/indice-tipos-depositos-plazo-portugal",
			"/fr/tools/indice-taux-depots-a-terme-portugal",
			"/de/tools/festgeldzins-index-portugal",
			"/it/tools/indice-tassi-depositi-vincolati-portogallo",
		])
		for (const lang of SUPPORTED_LANGS) {
			const slug = toLocalizedPath("toolDepositRateIndex", lang).split("/").pop() as string
			expect(resolveToolRouteId(lang, slug)).toBe("toolDepositRateIndex")
		}
	})

	it("is prerendered from the tool static paths in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const pages = getToolStaticPaths(lang).filter((path) => path.props.routeId === "toolDepositRateIndex")
			expect(pages).toHaveLength(1)
			expect(pages[0].params.tool).toBe(toLocalizedPath("toolDepositRateIndex", lang).split("/").pop())
		}
	})

	it("keeps the slug when switching language", () => {
		expect(toLocalizedPathname("/pt/tools/indice-taxas-depositos-a-prazo", "de")).toBe(
			"/de/tools/festgeldzins-index-portugal",
		)
	})

	it("can be linked from learn and glossary content about deposits, certificates and inflation", () => {
		expect(resolveToolRouteIdFromLegacy("deposit-rate-index", "en")).toBe("toolDepositRateIndex")
		for (const source of ["toolTermDeposit", "toolSavingsCertificates", "toolInflation"] as const) {
			expect(
				getRelatedContentTools([{ href: toLocalizedPath(source, "en") }], "en", () => "x").map((item) => item.href),
			).toContain(toLocalizedPath("toolDepositRateIndex", "en"))
			expect(getToolCatalogEntry(source).related).toContain("toolDepositRateIndex")
		}
	})

	it("is listed on the tools hub in every locale, in the investing group", () => {
		for (const lang of SUPPORTED_LANGS) {
			const hub = buildToolsHub(lang)
			expect(hub.flatMap((group) => group.tools).map((tool) => tool.href)).toContain(
				toLocalizedPath("toolDepositRateIndex", lang),
			)
			expect(hub.find((group) => group.id === "investAndGrow")?.tools.map((tool) => tool.routeId)).toContain(
				"toolDepositRateIndex",
			)
		}
	})

	it("links its guide to the term deposit, savings certificates and inflation tools", () => {
		const guide = readSource("../../components/calculators/DepositRateIndexGuide.astro")
		for (const routeId of ["toolTermDeposit", "toolSavingsCertificates", "toolInflation"]) {
			expect(guide).toContain(`toLocalizedPath("${routeId}", locale)`)
		}
		expect(getToolCatalogEntry("toolDepositRateIndex").related).toEqual([
			"toolTermDeposit",
			"toolSavingsCertificates",
			"toolInflation",
			"toolTermDepositOffers",
		])
	})

	it("has the same copy keys in every locale and in the public mirror", () => {
		const reference = keyPaths(readLocale("src/locales", "en").tools.depositRateIndex).sort()

		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.depositRateIndex
			expect(keyPaths(copy).sort()).toEqual(reference)
			expect(readLocale("public/locales", lang).tools.depositRateIndex).toEqual(copy)
		}
	})

	it("has a unique title and meta description per locale", () => {
		const copies = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).tools.depositRateIndex)

		expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("says it is an average, not the best offer, names no bank and cites and dates the data", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.depositRateIndex as unknown as {
				notBestOffer: string
				snapshot: { asOf: string }
				sourceNote: string
				guide: { read: { notBest: string; noRecommendation: string }; data: { source: string; inflation: string } }
			}
			expect(copy.notBestOffer.length).toBeGreaterThan(60)
			expect(copy.guide.read.notBest).toBeTruthy()
			expect(copy.guide.read.noRecommendation).toBeTruthy()
			expect(copy.snapshot.asOf).toContain("{{month}}")
			expect(copy.snapshot.asOf).toContain("{{retrieved}}")
			expect(copy.sourceNote).toContain("{{retrieved}}")
			expect(copy.sourceNote).toContain("BPstat")
			expect(copy.guide.data.source).toContain("{{retrieved}}")
			expect(copy.guide.data.inflation).toContain("{{cpiRetrieved}}")
			expect(JSON.stringify(copy)).not.toMatch(/Millennium|Santander|Novo Banco|\bBPI\b|Caixa Geral|Montepio|Bankinter|ActivoBank/i)
		}
	})

	it("offers a personal savings plan as the next step", () => {
		expect(readLocale("src/locales", "en").tools.depositRateIndex.nextStepHeadline).toBe(
			"Move from the benchmark to a personal savings plan",
		)
		expect(readSource("../../components/pages/ToolDetailPage.astro")).toContain(
			't("tools.depositRateIndex.nextStepHeadline")',
		)
	})

	it("addresses the pt reader as tu", () => {
		const pt = JSON.stringify(readLocale("src/locales", "pt").tools.depositRateIndex)

		expect(pt).not.toMatch(/(?<!\p{L})(?:você|seu|sua|seus|suas)(?!\p{L})/iu)
	})

	it("reports use without inputs or results, stores nothing and fetches nothing at runtime", () => {
		const source = readSource("../../components/calculators/DepositRateIndexComp.tsx")

		expect(source).toContain(
			'pushGtmEvent({ event: "tool_used", tool: "deposit_rate_index", page_type: getPageType() })',
		)
		expect(toolAnalyticsName("depositRateIndex")).toBe("deposit_rate_index")
		expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|fetch\(/)
	})
})

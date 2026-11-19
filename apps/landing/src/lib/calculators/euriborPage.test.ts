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

describe("Euribor today tool page", () => {
	it("has a localized tool route in every locale", () => {
		const paths = SUPPORTED_LANGS.map((lang) => toLocalizedPath("toolEuribor", lang))

		expect(paths).toEqual([
			"/pt/tools/euribor-hoje",
			"/en/tools/euribor-today-rates",
			"/es/tools/euribor-hoy",
			"/fr/tools/euribor-aujourdhui",
			"/de/tools/euribor-aktuell",
			"/it/tools/euribor-oggi",
		])
		for (const lang of SUPPORTED_LANGS) {
			const slug = toLocalizedPath("toolEuribor", lang).split("/").pop() as string
			expect(resolveToolRouteId(lang, slug)).toBe("toolEuribor")
		}
	})

	it("is prerendered from the tool static paths in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const pages = getToolStaticPaths(lang).filter((path) => path.props.routeId === "toolEuribor")
			expect(pages).toHaveLength(1)
		}
	})

	it("keeps the slug when switching language", () => {
		expect(toLocalizedPathname("/pt/tools/euribor-hoje", "de")).toBe("/de/tools/euribor-aktuell")
	})

	it("is linked from the mortgage, rate revision and mortgage transfer content", () => {
		expect(resolveToolRouteIdFromLegacy("euribor", "en")).toBe("toolEuribor")
		for (const source of ["toolMortgage", "toolRateRevision", "toolMortgageTransfer"] as const) {
			expect(
				getRelatedContentTools([{ href: toLocalizedPath(source, "en") }], "en", () => "x").map((item) => item.href),
			).toContain(toLocalizedPath("toolEuribor", "en"))
		}
	})

	it("is listed on the tools hub in every locale, in the borrow and buy a home group", () => {
		for (const lang of SUPPORTED_LANGS) {
			const hub = buildToolsHub(lang)
			expect(hub.flatMap((group) => group.tools).map((tool) => tool.href)).toContain(
				toLocalizedPath("toolEuribor", lang),
			)
			expect(hub.find((group) => group.id === "borrowAndBuyHome")?.tools.map((tool) => tool.routeId)).toContain(
				"toolEuribor",
			)
		}
		expect(getToolCatalogEntry("toolEuribor").related).toEqual(["toolRateRevision", "toolMortgage", "toolDebtToIncome"])
	})

	it("has the same copy keys in every locale and in the public mirror", () => {
		const reference = keyPaths(readLocale("src/locales", "en").tools.euribor).sort()

		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.euribor
			expect(keyPaths(copy).sort()).toEqual(reference)
			expect(readLocale("public/locales", lang).tools.euribor).toEqual(copy)
		}
	})

	it("has a unique title and meta description per locale", () => {
		const copies = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).tools.euribor)

		expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("shows the data date, the source and that only monthly averages are published", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.euribor as unknown as {
				asOf: string
				sourceNote: string
				current: { note: string }
				guide: { data: { source: string; daily: string; trademark: string } }
			}
			expect(copy.asOf).toContain("{{month}}")
			expect(copy.asOf).toContain("{{fetched}}")
			expect(copy.sourceNote).toContain("BPstat")
			expect(copy.sourceNote).toContain("EMMI")
			expect(copy.current.note).toContain("{{month}}")
			expect(copy.guide.data.source).toContain("{{fetched}}")
			expect(copy.guide.data.daily).toContain("BPstat")
			expect(copy.guide.data.trademark).toContain("EMMI")
		}
	})

	it("offers connecting rate changes to the debt budget as the next step", () => {
		expect(readLocale("src/locales", "en").tools.euribor.nextStepHeadline).toBe(
			"Connect rate changes to your debt budget",
		)
		expect(readSource("../../components/pages/ToolDetailPage.astro")).toContain(
			't("tools.euribor.nextStepHeadline")',
		)
	})

	it("addresses the pt reader as tu", () => {
		const pt = JSON.stringify(readLocale("src/locales", "pt").tools.euribor)

		expect(pt).not.toMatch(/(?<!\p{L})(?:você|seu|sua|seus|suas)(?!\p{L})/iu)
	})

	it("reuses the rate revision engine and reports use without inputs or results", () => {
		expect(readSource("./euribor.ts")).toContain('from "./rateRevision"')
		const source = readSource("../../components/calculators/EuriborCalculatorComp.tsx")

		expect(source).toContain('pushGtmEvent({ event: "tool_used", tool: "euribor", page_type: getPageType() })')
		expect(toolAnalyticsName("euribor")).toBe("euribor")
		expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/)
		expect(source).not.toMatch(/\bfetch\(/)
	})
})

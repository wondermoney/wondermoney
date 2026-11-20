import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { SAVINGS_GUIDE_RELATED_ROUTE_IDS } from "../../content/savingsGuide"
import { figureForTool } from "../hairline/articleFigures"
import { getToolStaticPaths } from "../pageStaticPaths"
import { getRelatedContentTools } from "../relatedContentTools"
import { SUPPORTED_LANGS, resolveToolRouteId, toLocalizedPath, toLocalizedPathname } from "../routes"
import { buildToolsHub, getToolCatalogEntry, toolAnalyticsName } from "../toolsCatalog"
import { PPR_PRODUCTS } from "./pprComparison"

type Copy = Record<string, unknown> & { pageTitle: string; pageDescription: string; nextStepHeadline: string }

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

function strings(value: unknown): string[] {
	if (typeof value === "string") return [value]
	if (typeof value !== "object" || value === null) return []
	return Object.values(value).flatMap(strings)
}

const SLUGS = [
	"/pt/tools/comparador-ppr",
	"/en/tools/ppr-comparison-portugal",
	"/es/tools/comparador-ppr-portugal",
	"/fr/tools/comparateur-ppr-portugal",
	"/de/tools/ppr-vergleich-portugal",
	"/it/tools/confronto-ppr-portogallo",
]

describe("PPR comparison tool page", () => {
	it("has a localized, prerendered tool route in every locale", () => {
		expect(SUPPORTED_LANGS.map((lang) => toLocalizedPath("toolPprComparison", lang))).toEqual(SLUGS)
		for (const lang of SUPPORTED_LANGS) {
			const slug = toLocalizedPath("toolPprComparison", lang).split("/").pop() as string
			expect(resolveToolRouteId(lang, slug)).toBe("toolPprComparison")
			expect(getToolStaticPaths(lang).filter((path) => path.props.routeId === "toolPprComparison")).toHaveLength(1)
		}
		expect(toLocalizedPathname(SLUGS[0], "fr")).toBe(SLUGS[3])
	})

	it("is on the tools hub under Invest and grow, with its figure and analytics name", () => {
		for (const lang of SUPPORTED_LANGS) {
			const hub = buildToolsHub(lang)
			expect(hub.find((group) => group.id === "investAndGrow")?.tools.map((tool) => tool.routeId)).toContain("toolPprComparison")
		}
		expect(figureForTool("toolPprComparison")).toBe("jar")
		expect(toolAnalyticsName("pprComparison")).toBe("ppr_comparison")
	})

	it("is linked from the pension tool, from learn and glossary pages about saving and investing, and from the savings guide", () => {
		expect(getToolCatalogEntry("toolStatePension").related).toContain("toolPprComparison")
		for (const routeId of ["toolStatePension", "toolCompoundInterest", "toolInvestorProfile"] as const) {
			expect(
				getRelatedContentTools([{ href: toLocalizedPath(routeId, "en") }], "en", () => "x").map((item) => item.href),
			).toContain(toLocalizedPath("toolPprComparison", "en"))
		}
		expect(SAVINGS_GUIDE_RELATED_ROUTE_IDS).toContain("toolPprComparison")
		const guide = readSource("../../components/calculators/PprComparisonGuide.astro")
		for (const routeId of getToolCatalogEntry("toolPprComparison").related) {
			expect(guide).toContain(`toLocalizedPath("${routeId}", locale)`)
		}
	})

	it("has the same copy keys in every locale and in the public mirror, with unique titles", () => {
		const reference = keyPaths(readLocale("src/locales", "en").tools.pprComparison).sort()
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.pprComparison
			expect(keyPaths(copy).sort()).toEqual(reference)
			expect(readLocale("public/locales", lang).tools.pprComparison).toEqual(copy)
		}
		const copies = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).tools.pprComparison)
		expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("names every type, fund category and guarantee in the data, in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.pprComparison as unknown as Record<string, Record<string, string>>
			for (const item of PPR_PRODUCTS) {
				expect(copy.kinds[item.kind]).toBeTruthy()
				if (item.category) expect(copy.categories[item.category]).toBeTruthy()
				for (const guarantee of [item.capitalGuarantee, item.returnGuarantee]) {
					if (guarantee) expect(copy.guarantees[guarantee]).toBeTruthy()
				}
			}
		}
	})

	it("offers the portfolio next step, addresses the pt reader as tu and spaces French punctuation", () => {
		expect(readLocale("src/locales", "en").tools.pprComparison.nextStepHeadline).toBe(
			"Track PPR balances in your long-term portfolio",
		)
		const page = readSource("../../components/pages/ToolDetailPage.astro")
		expect(page).toContain('t("tools.pprComparison.nextStepHeadline")')
		const pt = JSON.stringify(readLocale("src/locales", "pt").tools.pprComparison)
		expect(pt).not.toMatch(/(?<!\p{L})(?:você|seu|sua|seus|suas)(?!\p{L})/iu)
		for (const text of strings(readLocale("src/locales", "fr").tools.pprComparison)) {
			// \s would match the no-break space itself, so plain spaces are spelled out.
			expect(text).not.toMatch(/[^\u00a0][:;?!»]|[ \t\n][:;?!%€»]|\d%/u)
		}
		const de = JSON.stringify(readLocale("src/locales", "de").tools.pprComparison)
		expect(de).not.toMatch(/(?<!\p{L})(?:du|dein|deine|dich|dir)(?!\p{L})/iu)
	})

	it("makes no ranking claim and links only the supervisors and official sources", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = JSON.stringify(readLocale("src/locales", lang).tools.pprComparison)
			expect(copy).not.toMatch(/best PPR|melhor(?:es)? PPR|mejor(?:es)? PPR|meilleur(?:s)? PPR|beste[nr]? PPR|miglior[ei]? PPR/i)
		}
		const guide = readSource("../../components/calculators/PprComparisonGuide.astro")
		const island = readSource("../../components/calculators/PprComparisonComp.tsx")
		for (const source of [guide, island]) expect(source).not.toMatch(/https?:\/\//)
		for (const item of PPR_PRODUCTS) {
			if (item.documentUrl) expect(item.documentUrl).not.toMatch(/[?&](aff|affiliate|aff_id|referral|utm_[a-z]+)=/i)
		}
	})

	it("reports use without inputs or results, stores nothing and fetches nothing at runtime", () => {
		const source = readSource("../../components/calculators/PprComparisonComp.tsx")
		expect(source).toContain('pushGtmEvent({ event: "tool_used", tool: "ppr_comparison", page_type: getPageType() })')
		expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|fetch\(/)
	})
})

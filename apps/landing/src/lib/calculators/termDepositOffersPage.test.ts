import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { getToolStaticPaths } from "../pageStaticPaths"
import { SUPPORTED_LANGS, resolveToolRouteId, toLocalizedPath } from "../routes"
import { getRelatedContentTools } from "../relatedContentTools"
import { buildToolsHub, getToolCatalogEntry, toolAnalyticsName } from "../toolsCatalog"

type Copy = Record<string, unknown> & { pageTitle: string; pageDescription: string; nextStepHeadline: string; nextStepCta: string }

function readLocale(base: "src/locales" | "public/locales", lang: string) {
	const path = fileURLToPath(new URL(`../../../${base}/${lang}/common.json`, import.meta.url))
	return (JSON.parse(readFileSync(path, "utf8")) as { tools: Record<string, Copy> }).tools.termDepositOffers
}

function readSource(relativePath: string) {
	return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
}

function keyPaths(value: unknown, prefix = ""): string[] {
	if (typeof value !== "object" || value === null) return [prefix]
	return Object.entries(value).flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key))
}

describe("term deposit offers tool page", () => {
	it("has a localized route, prerendered in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const slug = toLocalizedPath("toolTermDepositOffers", lang).split("/").pop() as string
			expect(resolveToolRouteId(lang, slug)).toBe("toolTermDepositOffers")
			const pages = getToolStaticPaths(lang).filter((path) => path.props.routeId === "toolTermDepositOffers")
			expect(pages).toHaveLength(1)
		}
		expect(toLocalizedPath("toolTermDepositOffers", "pt")).toBe("/pt/tools/comparador-depositos-a-prazo")
	})

	it("is linked from term deposit, deposit rate index and savings certificates, and listed on the hub", () => {
		for (const source of ["toolTermDeposit", "toolDepositRateIndex", "toolSavingsCertificates"] as const) {
			expect(getToolCatalogEntry(source).related).toContain("toolTermDepositOffers")
			expect(
				getRelatedContentTools([{ href: toLocalizedPath(source, "en") }], "en", () => "x").map((item) => item.href),
			).toContain(toLocalizedPath("toolTermDepositOffers", "en"))
		}
		for (const lang of SUPPORTED_LANGS) {
			expect(
				buildToolsHub(lang).find((group) => group.id === "investAndGrow")?.tools.map((tool) => tool.routeId),
			).toContain("toolTermDepositOffers")
		}
	})

	it("has the same copy keys in every locale and in the public mirror, with a unique title", () => {
		const reference = keyPaths(readLocale("src/locales", "en")).sort()
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang)
			expect(keyPaths(copy).sort()).toEqual(reference)
			expect(readLocale("public/locales", lang)).toEqual(copy)
		}
		const titles = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).pageTitle)
		expect(new Set(titles).size).toBe(SUPPORTED_LANGS.length)
	})

	it("states the date, the guarantee, foreign banks and no affiliate links in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang) as unknown as {
				disclaimers: { asOf: string; fgd: string; foreign: string; noAffiliate: string }
				sourceNote: string
			}
			expect(copy.disclaimers.asOf).toContain("{{date}}")
			expect(copy.sourceNote).toContain("{{date}}")
			expect(copy.disclaimers.fgd).toMatch(/100[.,\s]?000/)
			expect(copy.disclaimers.foreign.length).toBeGreaterThan(30)
			expect(copy.disclaimers.noAffiliate.length).toBeGreaterThan(10)
		}
	})

	it("addresses the pt reader as tu", () => {
		const pt = JSON.stringify(readLocale("src/locales", "pt"))
		expect(pt).not.toMatch(/(?<!\p{L})(?:você|seu|sua|seus|suas)(?!\p{L})/iu)
	})

	it("offers tracking deposits as the next step", () => {
		expect(readLocale("src/locales", "en").nextStepHeadline).toBe("Track deposits and maturity dates together")
		expect(readSource("../../components/pages/ToolDetailPage.astro")).toContain('t("tools.termDepositOffers.nextStepHeadline")')
	})

	it("reports use without inputs or results, stores nothing and fetches nothing at runtime", () => {
		const source = readSource("../../components/calculators/TermDepositOffersComp.tsx")
		expect(source).toContain('pushGtmEvent({ event: "tool_used", tool: "term_deposit_offers", page_type: getPageType() })')
		expect(toolAnalyticsName("termDepositOffers")).toBe("term_deposit_offers")
		expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|fetch\(/)
		expect(source).not.toMatch(/Intl\.DateTimeFormat/)
	})
})

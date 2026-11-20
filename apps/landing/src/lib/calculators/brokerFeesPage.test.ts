import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { figureForTool } from "../hairline/articleFigures"
import { getToolStaticPaths } from "../pageStaticPaths"
import { getRelatedContentTools } from "../relatedContentTools"
import { SUPPORTED_LANGS, resolveToolRouteId, toLocalizedPath, toLocalizedPathname } from "../routes"
import { buildToolsHub, getToolCatalogEntry, toolAnalyticsName } from "../toolsCatalog"
import { BROKER_FEES } from "./brokerFees"

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

const SLUGS = [
	"/pt/tools/comparador-de-corretoras",
	"/en/tools/broker-fees-comparison-portugal",
	"/es/tools/comparador-brokers-portugal",
	"/fr/tools/comparateur-courtiers-portugal",
	"/de/tools/broker-vergleich-portugal",
	"/it/tools/confronto-broker-portogallo",
]

describe("broker fees tool page", () => {
	it("has a localized, prerendered tool route in every locale", () => {
		expect(SUPPORTED_LANGS.map((lang) => toLocalizedPath("toolBrokerFees", lang))).toEqual(SLUGS)
		for (const lang of SUPPORTED_LANGS) {
			const slug = toLocalizedPath("toolBrokerFees", lang).split("/").pop() as string
			expect(resolveToolRouteId(lang, slug)).toBe("toolBrokerFees")
			expect(getToolStaticPaths(lang).filter((path) => path.props.routeId === "toolBrokerFees")).toHaveLength(1)
		}
		expect(toLocalizedPathname(SLUGS[0], "de")).toBe(SLUGS[4])
	})

	it("is on the tools hub under Invest and grow, with its figure and analytics name", () => {
		for (const lang of SUPPORTED_LANGS) {
			const hub = buildToolsHub(lang)
			expect(hub.find((group) => group.id === "investAndGrow")?.tools.map((tool) => tool.routeId)).toContain(
				"toolBrokerFees",
			)
		}
		expect(figureForTool("toolBrokerFees")).toBe("etfbox")
		expect(toolAnalyticsName("brokerFees")).toBe("broker_fees")
	})

	it("is linked from the investing tools and from learn and glossary pages about them", () => {
		for (const routeId of ["toolInvestmentReturn", "toolInvestorProfile"] as const) {
			expect(getToolCatalogEntry(routeId).related).toContain("toolBrokerFees")
		}
		for (const routeId of ["toolCompoundInterest", "toolInvestmentReturn", "toolInvestorProfile"] as const) {
			expect(
				getRelatedContentTools([{ href: toLocalizedPath(routeId, "en") }], "en", () => "x").map((item) => item.href),
			).toContain(toLocalizedPath("toolBrokerFees", "en"))
		}
		const guide = readSource("../../components/calculators/BrokerFeesGuide.astro")
		for (const routeId of getToolCatalogEntry("toolBrokerFees").related) {
			expect(guide).toContain(`toLocalizedPath("${routeId}", locale)`)
		}
	})

	it("has the same copy keys in every locale and in the public mirror, with unique titles", () => {
		const reference = keyPaths(readLocale("src/locales", "en").tools.brokerFees).sort()
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.brokerFees
			expect(keyPaths(copy).sort()).toEqual(reference)
			expect(readLocale("public/locales", lang).tools.brokerFees).toEqual(copy)
		}
		const copies = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).tools.brokerFees)
		expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("names every broker's country and protection scheme, and has every broker note, in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.brokerFees as unknown as {
				countries: Record<string, string>
				schemes: Record<string, string>
				brokerNotes: Record<string, string>
			}
			for (const broker of BROKER_FEES) {
				expect(copy.countries[broker.country]).toBeTruthy()
				for (const protection of [broker.investorProtection, broker.depositGuarantee]) {
					if (protection) expect(copy.schemes[protection.scheme]).toBeTruthy()
				}
				expect(Boolean(copy.brokerNotes[broker.id])).toBe(broker.note)
			}
		}
	})

	it("offers the portfolio next step and addresses the pt reader as tu", () => {
		expect(readLocale("src/locales", "en").tools.brokerFees.nextStepHeadline).toBe(
			"Keep investments from different brokers in one overview",
		)
		const page = readSource("../../components/pages/ToolDetailPage.astro")
		expect(page).toContain('t("tools.brokerFees.nextStepHeadline")')
		expect(page).toContain('toLocalizedPath("featurePortfolio", locale)')
		const pt = JSON.stringify(readLocale("src/locales", "pt").tools.brokerFees)
		expect(pt).not.toMatch(/(?<!\p{L})(?:você|seu|sua|seus|suas)(?!\p{L})/iu)
	})

	it("makes no ranking claim and carries no affiliate links", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = JSON.stringify(readLocale("src/locales", lang).tools.brokerFees)
			expect(copy).not.toMatch(/best broker|melhor corretora|mejor bróker|meilleur courtier|bester broker|miglior broker/i)
		}
		for (const broker of BROKER_FEES) {
			for (const source of broker.sources) expect(source.url).not.toMatch(/[?&](aff|affiliate|aff_id|referral|utm_[a-z]+)=/i)
		}
	})

	it("reports use without inputs or results, stores nothing and fetches nothing at runtime", () => {
		const source = readSource("../../components/calculators/BrokerFeesComp.tsx")
		expect(source).toContain('pushGtmEvent({ event: "tool_used", tool: "broker_fees", page_type: getPageType() })')
		expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|fetch\(/)
	})
})

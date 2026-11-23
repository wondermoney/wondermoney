import { describe, expect, it } from "vitest"
import { ogImagePath, toolOgCard } from "./og/ogImages"
import { SUPPORTED_LANGS, TOOL_ROUTE_IDS, toLocalizedPath, toToolsHubPath } from "./routes"
import { buildToolStructuredData, buildWebSiteSchema, inLanguage } from "./structuredData"
import { DATASET_TOOL_ROUTE_IDS, loadToolDatasets, toolDataLastmod } from "./toolDatasets"
import { getToolCatalogEntry } from "./toolsCatalog"
import { getTranslations } from "./translations"

const DATASET_TOOLS = DATASET_TOOL_ROUTE_IDS
const TOOL_DATASETS = await loadToolDatasets()

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

type Node = Record<string, unknown>

/** What the page prints: the JSON a `<script type="application/ld+json">` carries, read back. */
function asPrinted(nodes: Node[]): Node[] {
	return nodes.map((node) => JSON.parse(JSON.stringify(node)) as Node)
}

function byType(nodes: Node[], type: string): Node[] {
	return nodes.filter((node) => node["@type"] === type)
}

describe("tool page structured data", () => {
	describe.each(SUPPORTED_LANGS)("%s", (locale) => {
		const t = getTranslations(locale)

		it.each(TOOL_ROUTE_IDS)("%s: a WebApplication and a BreadcrumbList from what the page shows", async (routeId) => {
			const nodes = asPrinted(await buildToolStructuredData(routeId, locale))
			const { key } = getToolCatalogEntry(routeId)
			const url = `https://wonder.money${toLocalizedPath(routeId, locale)}`
			const title = t(`tools.${key}.title`)

			for (const node of nodes) expect(node["@context"]).toBe("https://schema.org")

			const [app] = byType(nodes, "WebApplication")
			expect(app).toMatchObject({
				name: title,
				description: t(`tools.${key}.subtitle`),
				url,
				image: `https://wonder.money${ogImagePath(toolOgCard(routeId, locale).pagePath)}`,
				inLanguage: inLanguage(locale),
				isAccessibleForFree: true,
				applicationCategory: "FinanceApplication",
				publisher: { "@type": "Organization", name: "WonderMoney", url: "https://wonder.money" },
			})
			expect(String(app.description).length).toBeGreaterThan(0)

			// The trail ArticleHero draws: home, the tools hub, the tool.
			const [breadcrumbs] = byType(nodes, "BreadcrumbList")
			expect(breadcrumbs.itemListElement).toEqual([
				{ "@type": "ListItem", position: 1, name: t("nav.home"), item: `https://wonder.money/${locale}` },
				{ "@type": "ListItem", position: 2, name: t("header.tools"), item: `https://wonder.money${toToolsHubPath(locale)}` },
				{ "@type": "ListItem", position: 3, name: title, item: url },
			])

			// No question-and-answer content on a tool page, so no FAQPage.
			expect(byType(nodes, "FAQPage")).toEqual([])
		})

		it.each(TOOL_ROUTE_IDS)("%s: a Dataset only for a data-snapshot tool", async (routeId) => {
			const datasets = byType(asPrinted(await buildToolStructuredData(routeId, locale)), "Dataset")
			const isDataTool = (DATASET_TOOLS as readonly string[]).includes(routeId)
			expect(datasets).toHaveLength(isDataTool ? 1 : 0)
			if (!isDataTool) return

			const [dataset] = datasets
			const { key } = getToolCatalogEntry(routeId)
			expect(dataset.name).toBe(t(`tools.${key}.title`))
			// Search engines want a dataset description of at least 50 characters.
			expect(String(dataset.description).length).toBeGreaterThanOrEqual(50)
			expect(dataset.url).toBe(`https://wonder.money${toLocalizedPath(routeId, locale)}`)
			expect(dataset.dateModified).toMatch(ISO_DATE)
			expect(dataset.dateModified).toBe(TOOL_DATASETS[routeId as (typeof DATASET_TOOLS)[number]].dateModified)
			expect(dataset.isAccessibleForFree).toBe(true)
			expect((dataset.creator as Node).name).toEqual(expect.any(String))
		})
	})

	it("describes exactly the five data-snapshot tools", () => {
		expect(Object.keys(TOOL_DATASETS).sort()).toEqual(
			["toolElectricityTariffComparison", "toolEuribor", "toolFreeBankAccounts", "toolFuelPrices", "toolTermDepositOffers"],
		)
	})
})

describe("toolDataLastmod", () => {
	it("dates a data-snapshot tool page in every locale with its data's date", () => {
		for (const routeId of DATASET_TOOLS) {
			for (const locale of SUPPORTED_LANGS) {
				const path = toLocalizedPath(routeId, locale)
				expect(toolDataLastmod(path, TOOL_DATASETS)).toBe(TOOL_DATASETS[routeId].dateModified)
				expect(toolDataLastmod(`${path}/`, TOOL_DATASETS)).toBe(TOOL_DATASETS[routeId].dateModified)
			}
		}
	})

	it("leaves other pages undated", () => {
		expect(toolDataLastmod(toLocalizedPath("toolMortgage", "en"), TOOL_DATASETS)).toBeUndefined()
		expect(toolDataLastmod(toToolsHubPath("pt"), TOOL_DATASETS)).toBeUndefined()
		expect(toolDataLastmod("/pt", TOOL_DATASETS)).toBeUndefined()
	})
})

describe("buildWebSiteSchema", () => {
	it("names the site, its language and its publisher", () => {
		expect(buildWebSiteSchema("pt")).toEqual({
			"@context": "https://schema.org",
			"@type": "WebSite",
			"@id": "https://wonder.money/#website",
			name: "WonderMoney",
			url: "https://wonder.money",
			inLanguage: "pt-PT",
			publisher: { "@id": "https://wonder.money/#organization" },
		})
	})
})

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { getToolStaticPaths, getTopLevelPageStaticPaths } from "./pageStaticPaths"
import { SUPPORTED_LANGS, TOOL_ROUTE_IDS, toLocalizedPath, type Lang } from "./routes"
import {
	TOOLS_CATALOG,
	TOOLS_IN_DISPLAY_ORDER,
	TOOL_GROUPS,
	buildToolsHub,
	buildToolsHubItemList,
	getToolCatalogEntry,
	toolAnalyticsName,
} from "./toolsCatalog"
import { getTranslations } from "./translations"

const HUB_ROUTE_IDS = [...TOOL_ROUTE_IDS, "pageFireCalculator"] as const

function readSource(relativePath: string): string {
	return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
}

type Copy = { tools: Record<string, Record<string, unknown>> }

function readLocale(base: "src/locales" | "public/locales", lang: string): Copy {
	return JSON.parse(readSource(`../../${base}/${lang}/common.json`)) as Copy
}

function keyPaths(value: unknown, prefix = ""): string[] {
	if (typeof value !== "object" || value === null) return [prefix]
	return Object.entries(value).flatMap(([key, child]) =>
		keyPaths(child, prefix ? `${prefix}.${key}` : key),
	)
}

describe("tools catalog", () => {
	it("lists every tool route and the FIRE calculator exactly once, and nothing else", () => {
		const routeIds = TOOLS_CATALOG.map((tool) => tool.routeId)

		expect([...routeIds].sort()).toEqual([...HUB_ROUTE_IDS].sort())
		expect(new Set(routeIds).size).toBe(routeIds.length)
		expect(new Set(TOOLS_CATALOG.map((tool) => tool.key)).size).toBe(TOOLS_CATALOG.length)
	})

	it.each(HUB_ROUTE_IDS)("puts %s in exactly one task group", (routeId) => {
		const entries = TOOLS_CATALOG.filter((tool) => tool.routeId === routeId)
		const groupIds: readonly string[] = TOOL_GROUPS.map((group) => group.id)

		expect(entries).toHaveLength(1)
		expect(groupIds).toContain(entries[0].group)
	})

	it("groups the tools by the task a visitor comes with, in the agreed order", () => {
		const groups = Object.fromEntries(
			TOOL_GROUPS.map((group) => [
				group.id,
				TOOLS_IN_DISPLAY_ORDER.filter((tool) => tool.group === group.id).map((tool) => tool.routeId),
			]),
		)

		expect(TOOL_GROUPS.map((group) => group.id)).toEqual([
			"budgetAndSave",
			"borrowAndBuyHome",
			"investAndGrow",
			"trackWealth",
		])
		expect(groups).toEqual({
			budgetAndSave: ["toolHouseholdBudget", "toolSavingsRate", "toolEmergencyFund", "toolSavingsGoal", "toolInflation", "toolNetSalary", "toolChristmasAllowance", "toolHolidayAllowance", "toolWithholdingTables", "toolUnemploymentBenefit", "toolSickPay", "toolDismissalCompensation", "toolElectricityIndex", "toolElectricityTariffComparison", "toolFuelPrices", "toolFreeBankAccounts"],
			borrowAndBuyHome: ["toolMortgage", "toolDebtToIncome", "toolBorrowingCapacity", "toolEarlyRepayment", "toolMortgageTransfer", "toolBuyVsRent", "toolRateRevision", "toolEuribor", "toolCarLoan", "toolPropertyTax", "toolPurchaseTaxes", "toolYouthMortgage", "toolVehicleTax", "toolPropertyCapitalGains", "toolPersonalLoan"],
			investAndGrow: ["toolCompoundInterest", "toolInvestmentReturn", "toolSp500History", "toolInvestorProfile", "pageFireCalculator", "toolStatePension", "toolTermDeposit", "toolSavingsCertificates", "toolDepositRateIndex", "toolTermDepositOffers", "toolRemuneratedAccounts", "toolBrokerFees"],
			trackWealth: ["toolNetWorth", "toolGoldPrice"],
		})
	})

	it("is written in display order, so the module reads like the page", () => {
		expect(TOOLS_CATALOG.map((tool) => tool.routeId)).toEqual(
			TOOLS_IN_DISPLAY_ORDER.map((tool) => tool.routeId),
		)
	})

	it("gives every group a unique anchor", () => {
		const anchors = TOOL_GROUPS.map((group) => group.anchor)

		expect(new Set(anchors).size).toBe(anchors.length)
		for (const anchor of anchors) expect(anchor).toMatch(/^[a-z]+(-[a-z]+)*$/)
	})

	it.each(TOOL_ROUTE_IDS)("gives %s related tools that are other /tools pages", (routeId) => {
		const { related } = getToolCatalogEntry(routeId)

		expect(related.length).toBeGreaterThan(0)
		expect(new Set(related).size).toBe(related.length)
		expect(related).not.toContain(routeId)
		for (const relatedRouteId of related) expect(TOOL_ROUTE_IDS).toContain(relatedRouteId)
	})

	it("names each tool for analytics the way its tool_used event does", () => {
		expect(toolAnalyticsName("householdBudget")).toBe("household_budget")
		expect(toolAnalyticsName("debtToIncome")).toBe("debt_to_income")
		expect(toolAnalyticsName("fire")).toBe("fire")
		expect(readSource("../components/calculators/HouseholdBudgetCalculatorComp.tsx")).toContain(
			'tool: "household_budget"',
		)
	})
})

describe("tools hub", () => {
	it.each(SUPPORTED_LANGS)("renders every tool in %s, each linking to a page that exists there", (lang) => {
		const hub = buildToolsHub(lang)
		const rendered = hub.flatMap((group) => group.tools)
		const toolPages = getToolStaticPaths(lang)
			.map((path) => `/${lang}/tools/${path.params.tool}`)
		const topLevelPages = getTopLevelPageStaticPaths(lang)
			.map((path) => `/${lang}/${path.params.page}`)

		expect(hub.map((group) => group.id)).toEqual(TOOL_GROUPS.map((group) => group.id))
		for (const group of hub) expect(group.tools.length).toBeGreaterThan(0)
		expect(rendered.map((tool) => tool.routeId)).toEqual(TOOLS_IN_DISPLAY_ORDER.map((tool) => tool.routeId))
		for (const tool of rendered) {
			expect(tool.href).toBe(toLocalizedPath(tool.routeId, lang))
			expect([...toolPages, ...topLevelPages]).toContain(tool.href)
		}
	})

	it.each(SUPPORTED_LANGS)("lists every tool in the %s ItemList, flat and in display order", (lang) => {
		const t = getTranslations(lang)
		const itemList = buildToolsHubItemList(lang, t)

		expect(itemList["@type"]).toBe("ItemList")
		expect(itemList.url).toBe(`https://wonder.money/${lang}/tools`)
		expect(itemList.numberOfItems).toBe(TOOLS_CATALOG.length)
		expect(itemList.itemListElement).toEqual(
			TOOLS_IN_DISPLAY_ORDER.map((tool, index) => ({
				"@type": "ListItem",
				position: index + 1,
				name: t(`tools.${tool.key}.title`),
				url: `https://wonder.money${toLocalizedPath(tool.routeId, lang)}`,
			})),
		)
	})

	it.each(SUPPORTED_LANGS)("keeps the %s hub route file thin", (lang) => {
		const source = readSource(`../pages/${lang}/tools/index.astro`)

		expect(source).toContain(`<ToolsHubPage locale="${lang}" />`)
		expect(source).toContain("export const prerender = true")
		expect(source).not.toContain("routeId")
	})
})

describe("tools hub copy", () => {
	const reference = keyPaths(readLocale("src/locales", "en").tools.hub).sort()

	it("has the task intro and a heading and intro for every group", () => {
		expect(reference).toEqual(
			expect.arrayContaining([
				"tasks.title",
				"tasks.description",
				...TOOL_GROUPS.flatMap((group) => [`groups.${group.id}.title`, `groups.${group.id}.intro`]),
			]),
		)
	})

	it.each(SUPPORTED_LANGS)("has the same hub keys in %s and in its public mirror", (lang: Lang) => {
		const copy = readLocale("src/locales", lang)

		expect(keyPaths(copy.tools.hub).sort()).toEqual(reference)
		for (const path of reference) {
			const value = path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], copy.tools.hub)
			expect(value, `${lang} tools.hub.${path}`).toEqual(expect.stringMatching(/\S/))
		}
		expect(readLocale("public/locales", lang).tools.hub).toEqual(copy.tools.hub)
	})

	it.each(SUPPORTED_LANGS)("has a title, short name and description in %s for every tool on the hub", (lang) => {
		const copy = readLocale("src/locales", lang)

		for (const tool of TOOLS_CATALOG) {
			expect(copy.tools[tool.key]?.title, `${lang} tools.${tool.key}.title`).toEqual(expect.stringMatching(/\S/))
			// The header's Tools menu lists tools by this name, in columns that fit a 1024 px screen.
			expect(copy.tools[tool.key]?.shortName, `${lang} tools.${tool.key}.shortName`).toEqual(
				expect.stringMatching(/^\S.{0,35}$/),
			)
			expect(copy.tools[tool.key]?.description, `${lang} tools.${tool.key}.description`).toEqual(
				expect.stringMatching(/\S/),
			)
		}
	})

	it("has a unique title and meta description per locale", () => {
		const hubs = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).tools.hub)

		expect(new Set(hubs.map((hub) => hub.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(hubs.map((hub) => hub.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("addresses the pt reader as tu", () => {
		const copy = JSON.stringify(readLocale("src/locales", "pt").tools.hub)

		expect(copy).not.toMatch(/\bvocê\b|\bseu\b|\bsua\b|\bseus\b|\bsuas\b/iu)
	})
})

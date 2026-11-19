import { toLocalizedPath, toToolsHubPath, type Lang, type ToolRouteId } from "./routes"
import type { Translate } from "./translations"

/**
 * The tasks a visitor comes to the tools hub with, in the order the hub shows them. Each has a
 * heading and a one-line intro under `tools.hub.groups.<id>` in every locale, and `anchor` is the
 * id of its section, which the task links at the top of the hub point to.
 */
export const TOOL_GROUPS = [
	{ id: "budgetAndSave", anchor: "budget-and-save" },
	{ id: "borrowAndBuyHome", anchor: "borrow-and-buy-a-home" },
	{ id: "investAndGrow", anchor: "invest-and-grow" },
	{ id: "trackWealth", anchor: "track-your-wealth" },
] as const

export type ToolGroupId = (typeof TOOL_GROUPS)[number]["id"]

/** A page the hub lists: a /tools page, or a calculator with its own page such as FIRE. */
export type CatalogRouteId = ToolRouteId | "pageFireCalculator"

export interface ToolCatalogEntry {
	/**
	 * Copy key: the hub card reads `tools.<key>.title` and `tools.<key>.description`, and the
	 * header's Tools menu `tools.<key>.shortName`.
	 */
	readonly key: string
	readonly routeId: CatalogRouteId
	readonly group: ToolGroupId
	/** The tools a /tools page suggests next, in order. Only /tools pages have them. */
	readonly related?: readonly ToolRouteId[]
}

/**
 * Every calculator on the landing site, the one list the tools hub, its ItemList and the related
 * tools of each /tools page read. Entries are written group by group in display order.
 *
 * Adding a tool: add its route to `TOOL_ROUTE_IDS`, one entry here, in its group, and its
 * `title`, `shortName` and `description` under `tools.<key>` in every locale. The hub, the header's
 * Tools menu and the mobile drawer pick it up. `toolsCatalog.test.ts` fails until all are done.
 */
export const TOOLS_CATALOG = [
	// Budget and save
	{
		key: "householdBudget",
		routeId: "toolHouseholdBudget",
		group: "budgetAndSave",
		related: ["toolSavingsRate", "toolNetWorth", "toolCompoundInterest"],
	},
	{
		key: "savingsRate",
		routeId: "toolSavingsRate",
		group: "budgetAndSave",
		related: ["toolCompoundInterest", "toolNetWorth", "toolInvestmentReturn"],
	},
	{
		key: "emergencyFund",
		routeId: "toolEmergencyFund",
		group: "budgetAndSave",
		related: ["toolSavingsRate", "toolNetWorth", "toolCompoundInterest"],
	},
	{
		key: "savingsGoal",
		routeId: "toolSavingsGoal",
		group: "budgetAndSave",
		related: ["toolCompoundInterest", "toolSavingsRate", "toolEmergencyFund"],
	},
	{
		key: "inflation",
		routeId: "toolInflation",
		group: "budgetAndSave",
		related: ["toolHouseholdBudget", "toolSavingsGoal", "toolInvestmentReturn"],
	},
	// Borrow and buy a home
	{
		key: "mortgage",
		routeId: "toolMortgage",
		group: "borrowAndBuyHome",
		related: ["toolDebtToIncome", "toolEarlyRepayment", "toolSavingsRate"],
	},
	{
		key: "debtToIncome",
		routeId: "toolDebtToIncome",
		group: "borrowAndBuyHome",
		related: ["toolSavingsRate", "toolNetWorth", "toolCompoundInterest"],
	},
	{
		key: "borrowingCapacity",
		routeId: "toolBorrowingCapacity",
		group: "borrowAndBuyHome",
		related: ["toolMortgage", "toolDebtToIncome", "toolSavingsGoal"],
	},
	{
		key: "earlyRepayment",
		routeId: "toolEarlyRepayment",
		group: "borrowAndBuyHome",
		related: ["toolMortgage", "toolDebtToIncome", "toolEmergencyFund"],
	},
	{
		key: "mortgageTransfer",
		routeId: "toolMortgageTransfer",
		group: "borrowAndBuyHome",
		related: ["toolMortgage", "toolEarlyRepayment", "toolDebtToIncome"],
	},
	{
		key: "buyVsRent",
		routeId: "toolBuyVsRent",
		group: "borrowAndBuyHome",
		related: ["toolMortgage", "toolNetWorth", "toolCompoundInterest"],
	},
	{
		key: "rateRevision",
		routeId: "toolRateRevision",
		group: "borrowAndBuyHome",
		related: ["toolMortgage", "toolDebtToIncome", "toolEarlyRepayment"],
	},
	{
		key: "carLoan",
		routeId: "toolCarLoan",
		group: "borrowAndBuyHome",
		related: ["toolHouseholdBudget", "toolPersonalLoan", "toolDebtToIncome"],
	},
	{
		key: "personalLoan",
		routeId: "toolPersonalLoan",
		group: "borrowAndBuyHome",
		related: ["toolDebtToIncome", "toolHouseholdBudget", "toolEarlyRepayment"],
	},
	{
		key: "propertyTax",
		routeId: "toolPropertyTax",
		group: "borrowAndBuyHome",
		related: ["toolHouseholdBudget", "toolMortgage", "toolBuyVsRent"],
	},
	// Invest and grow
	{
		key: "compoundInterest",
		routeId: "toolCompoundInterest",
		group: "investAndGrow",
		related: ["toolNetWorth", "toolSavingsRate", "toolInvestmentReturn"],
	},
	{
		key: "investmentReturn",
		routeId: "toolInvestmentReturn",
		group: "investAndGrow",
		related: ["toolCompoundInterest", "toolNetWorth", "toolSavingsRate"],
	},
	{
		key: "investorProfile",
		routeId: "toolInvestorProfile",
		group: "investAndGrow",
		related: ["toolInvestmentReturn", "toolCompoundInterest", "toolEmergencyFund"],
	},
	{ key: "fire", routeId: "pageFireCalculator", group: "investAndGrow" },
	{
		key: "termDeposit",
		routeId: "toolTermDeposit",
		group: "investAndGrow",
		related: ["toolCompoundInterest", "toolSavingsGoal", "toolEmergencyFund"],
	},
	// Track your wealth
	{
		key: "netWorth",
		routeId: "toolNetWorth",
		group: "trackWealth",
		related: ["toolCompoundInterest", "toolSavingsRate", "toolInvestmentReturn"],
	},
] as const satisfies readonly ToolCatalogEntry[]

const CATALOG: readonly ToolCatalogEntry[] = TOOLS_CATALOG

/** The catalog in the order the hub shows it: group by group, then as written within a group. */
export const TOOLS_IN_DISPLAY_ORDER: readonly ToolCatalogEntry[] = TOOL_GROUPS.flatMap((group) =>
	CATALOG.filter((tool) => tool.group === group.id),
)

export function getToolCatalogEntry(routeId: CatalogRouteId): ToolCatalogEntry & {
	readonly related: readonly ToolRouteId[]
} {
	const entry = CATALOG.find((tool) => tool.routeId === routeId)

	if (!entry) {
		throw new Error(`Tool missing from the tools catalog: ${routeId}`)
	}

	return { ...entry, related: entry.related ?? [] }
}

/** The name analytics events use for a tool, as its `tool_used` event does: `household_budget`. */
export function toolAnalyticsName(key: string): string {
	return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

export interface ToolsHubTool extends ToolCatalogEntry {
	readonly href: string
	/** 1-based position on the hub, across groups, as in the ItemList. */
	readonly position: number
}

export interface ToolsHubGroup {
	readonly id: ToolGroupId
	readonly anchor: string
	readonly tools: readonly ToolsHubTool[]
}

/**
 * The hub's groups for one locale, each with its tools and their localized links. The header's
 * Tools menu reads the same groups, so a new catalog entry reaches both. `catalog` is the full
 * catalog unless a test passes another.
 */
export function buildToolsHub(lang: Lang, catalog: readonly ToolCatalogEntry[] = CATALOG): ToolsHubGroup[] {
	let position = 0

	return TOOL_GROUPS.map((group) => ({
		id: group.id,
		anchor: group.anchor,
		tools: catalog.filter((tool) => tool.group === group.id).map((tool) => ({
			...tool,
			href: toLocalizedPath(tool.routeId, lang),
			position: ++position,
		})),
	}))
}

/** The hub's ItemList structured data: every tool, flat, in display order. */
export function buildToolsHubItemList(lang: Lang, t: Translate) {
	const tools = buildToolsHub(lang).flatMap((group) => group.tools)

	return {
		"@context": "https://schema.org",
		"@type": "ItemList",
		name: t("tools.hub.title"),
		description: t("tools.hub.description"),
		url: `https://wonder.money${toToolsHubPath(lang)}`,
		numberOfItems: tools.length,
		itemListElement: tools.map((tool) => ({
			"@type": "ListItem",
			position: tool.position,
			name: t(`tools.${tool.key}.title`),
			url: `https://wonder.money${tool.href}`,
		})),
	}
}

import {
	ArrowLeftRight,
	BadgePercent,
	Banknote,
	Briefcase,
	Building,
	Calculator,
	CalendarClock,
	Car,
	CarFront,
	ChartCandlestick,
	ChartColumn,
	ChartLine,
	DoorOpen,
	Flag,
	Flame,
	Fuel,
	Gauge,
	Gem,
	Gift,
	HandCoins,
	HeartPulse,
	History,
	Hourglass,
	House,
	HousePlus,
	KeyRound,
	Landmark,
	Layers,
	LifeBuoy,
	Percent,
	PiggyBank,
	PlugZap,
	Receipt,
	RefreshCw,
	Scale,
	ScrollText,
	ShoppingBasket,
	Sprout,
	Table,
	TreePalm,
	TrendingUp,
	Umbrella,
	UserCheck,
	Vault,
	Wallet,
	Zap,
	type LucideIcon,
} from "lucide-react"
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

/**
 * The header's Tools menu splits the long task groups under these headings, in this order, so
 * no run of links is longer than about eight. Each has a heading under
 * `header.toolsMenu.subgroups.<id>` in every locale. A group with no subgroups (track your
 * wealth) lists its tools under the group heading alone. The hub does not show them.
 */
export const TOOL_SUBGROUPS = [
	{ id: "planAndSave", group: "budgetAndSave" },
	{ id: "salaryAndBenefits", group: "budgetAndSave" },
	{ id: "pricesAndInflation", group: "budgetAndSave" },
	{ id: "homeLoan", group: "borrowAndBuyHome" },
	{ id: "buyingAndTaxes", group: "borrowAndBuyHome" },
	{ id: "carAndPersonalLoans", group: "borrowAndBuyHome" },
	{ id: "investing", group: "investAndGrow" },
	{ id: "retirement", group: "investAndGrow" },
	{ id: "depositsAndCertificates", group: "investAndGrow" },
] as const satisfies ReadonlyArray<{ id: string; group: ToolGroupId }>

export type ToolSubgroupId = (typeof TOOL_SUBGROUPS)[number]["id"]

/**
 * The header's Tools menu, as columns of task groups, so the columns come out about as long as
 * each other: the two short groups share the last one.
 */
export const TOOLS_MENU_COLUMNS = [
	["budgetAndSave"],
	["borrowAndBuyHome"],
	["investAndGrow", "trackWealth"],
] as const satisfies ReadonlyArray<ReadonlyArray<ToolGroupId>>

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
	/** The outline icon the header's menus and the mobile drawer show before the tool's name. */
	readonly icon: LucideIcon
	/**
	 * The heading the tool sits under in the header's Tools menu, one of its group's
	 * `TOOL_SUBGROUPS`. Left out for a comparator, and in a group with no subgroups.
	 */
	readonly subgroup?: ToolSubgroupId
	/**
	 * A page that compares offers from providers (banks, brokers, suppliers): the header lists it
	 * in the Comparators menu instead of the Tools menu. The hub lists it in its group as usual.
	 */
	readonly comparator?: true
	/** The tools a calculator page suggests next, in order: every /tools page, and the FIRE page. */
	readonly related?: readonly ToolRouteId[]
}

/**
 * Every calculator on the landing site, the one list the tools hub, its ItemList and the related
 * tools of each /tools page read. Entries are written group by group in display order. The first
 * tool of a group leads it on the hub as the one card with a figure, so put the group's most
 * sought-after tool first.
 *
 * Adding a tool: add its route to `TOOL_ROUTE_IDS`, one entry here, in its group, with a
 * lucide icon and either its `subgroup` or `comparator: true`, and its `title`, `shortName` and
 * `description` under `tools.<key>` in every locale (a comparator also needs its line under
 * `header.comparatorsMenu.items.<key>`). The hub, the header's Tools or Comparators menu and the
 * mobile drawer pick it up. `toolsCatalog.test.ts` fails until all are done.
 */
export const TOOLS_CATALOG = [
	// Budget and save
	{
		key: "householdBudget",
		routeId: "toolHouseholdBudget",
		group: "budgetAndSave",
		icon: Wallet,
		subgroup: "planAndSave",
		related: ["toolSavingsRate", "toolNetWorth", "toolCompoundInterest", "toolFreeBankAccounts", "toolRemuneratedAccounts"],
	},
	{
		key: "savingsRate",
		routeId: "toolSavingsRate",
		group: "budgetAndSave",
		icon: Percent,
		subgroup: "planAndSave",
		related: ["toolCompoundInterest", "toolNetWorth", "toolInvestmentReturn"],
	},
	{
		key: "emergencyFund",
		routeId: "toolEmergencyFund",
		group: "budgetAndSave",
		icon: LifeBuoy,
		subgroup: "planAndSave",
		related: ["toolSavingsRate", "toolNetWorth", "toolCompoundInterest", "toolUnemploymentBenefit", "toolSickPay"],
	},
	{
		key: "savingsGoal",
		routeId: "toolSavingsGoal",
		group: "budgetAndSave",
		icon: Flag,
		subgroup: "planAndSave",
		related: ["toolCompoundInterest", "toolSavingsRate", "toolEmergencyFund"],
	},
	{
		key: "inflation",
		routeId: "toolInflation",
		group: "budgetAndSave",
		icon: ShoppingBasket,
		subgroup: "pricesAndInflation",
		related: ["toolHouseholdBudget", "toolSavingsGoal", "toolInvestmentReturn", "toolDepositRateIndex"],
	},
	{
		key: "netSalary",
		routeId: "toolNetSalary",
		group: "budgetAndSave",
		icon: Banknote,
		subgroup: "salaryAndBenefits",
		related: ["toolWithholdingTables", "toolHouseholdBudget", "toolSavingsRate", "toolUnemploymentBenefit", "toolDismissalCompensation"],
	},
	{
		key: "christmasAllowance",
		routeId: "toolChristmasAllowance",
		group: "budgetAndSave",
		icon: Gift,
		subgroup: "salaryAndBenefits",
		related: ["toolHolidayAllowance", "toolNetSalary", "toolSavingsGoal"],
	},
	{
		key: "holidayAllowance",
		routeId: "toolHolidayAllowance",
		group: "budgetAndSave",
		icon: TreePalm,
		subgroup: "salaryAndBenefits",
		related: ["toolChristmasAllowance", "toolNetSalary", "toolSavingsGoal"],
	},
	{
		key: "withholdingTables",
		routeId: "toolWithholdingTables",
		group: "budgetAndSave",
		icon: Table,
		subgroup: "salaryAndBenefits",
		related: ["toolNetSalary", "toolHouseholdBudget", "toolBorrowingCapacity"],
	},
	{
		key: "unemploymentBenefit",
		routeId: "toolUnemploymentBenefit",
		group: "budgetAndSave",
		icon: Briefcase,
		subgroup: "salaryAndBenefits",
		related: ["toolEmergencyFund", "toolHouseholdBudget", "toolNetSalary", "toolSickPay", "toolDismissalCompensation"],
	},
	{
		key: "sickPay",
		routeId: "toolSickPay",
		group: "budgetAndSave",
		icon: HeartPulse,
		subgroup: "salaryAndBenefits",
		related: ["toolNetSalary", "toolEmergencyFund", "toolHouseholdBudget"],
	},
	{
		key: "dismissalCompensation",
		routeId: "toolDismissalCompensation",
		group: "budgetAndSave",
		icon: DoorOpen,
		subgroup: "salaryAndBenefits",
		related: ["toolUnemploymentBenefit", "toolEmergencyFund", "toolNetSalary"],
	},
	{
		key: "electricityIndex",
		routeId: "toolElectricityIndex",
		group: "budgetAndSave",
		icon: Zap,
		subgroup: "pricesAndInflation",
		related: ["toolHouseholdBudget", "toolEmergencyFund", "toolInflation"],
	},
	{
		key: "electricityTariffComparison",
		routeId: "toolElectricityTariffComparison",
		group: "budgetAndSave",
		icon: PlugZap,
		comparator: true,
		related: ["toolElectricityIndex", "toolHouseholdBudget", "toolEmergencyFund"],
	},
	{
		key: "fuelPrices",
		routeId: "toolFuelPrices",
		group: "budgetAndSave",
		icon: Fuel,
		subgroup: "pricesAndInflation",
		related: ["toolHouseholdBudget", "toolCarLoan", "toolVehicleTax"],
	},
	{
		key: "freeBankAccounts",
		routeId: "toolFreeBankAccounts",
		group: "budgetAndSave",
		icon: Landmark,
		comparator: true,
		related: ["toolRemuneratedAccounts", "toolHouseholdBudget", "toolEmergencyFund", "toolSavingsRate"],
	},
	// Borrow and buy a home
	{
		key: "mortgage",
		routeId: "toolMortgage",
		group: "borrowAndBuyHome",
		icon: House,
		subgroup: "homeLoan",
		related: ["toolDebtToIncome", "toolEarlyRepayment", "toolSavingsRate"],
	},
	{
		key: "debtToIncome",
		routeId: "toolDebtToIncome",
		group: "borrowAndBuyHome",
		icon: Gauge,
		subgroup: "homeLoan",
		related: ["toolSavingsRate", "toolNetWorth", "toolCompoundInterest"],
	},
	{
		key: "borrowingCapacity",
		routeId: "toolBorrowingCapacity",
		group: "borrowAndBuyHome",
		icon: Calculator,
		subgroup: "homeLoan",
		related: ["toolMortgage", "toolDebtToIncome", "toolSavingsGoal"],
	},
	{
		key: "earlyRepayment",
		routeId: "toolEarlyRepayment",
		group: "borrowAndBuyHome",
		icon: CalendarClock,
		subgroup: "homeLoan",
		related: ["toolMortgage", "toolDebtToIncome", "toolEmergencyFund"],
	},
	{
		key: "mortgageTransfer",
		routeId: "toolMortgageTransfer",
		group: "borrowAndBuyHome",
		icon: ArrowLeftRight,
		subgroup: "homeLoan",
		related: ["toolMortgage", "toolEarlyRepayment", "toolDebtToIncome"],
	},
	{
		key: "buyVsRent",
		routeId: "toolBuyVsRent",
		group: "borrowAndBuyHome",
		icon: Scale,
		subgroup: "buyingAndTaxes",
		related: ["toolMortgage", "toolNetWorth", "toolCompoundInterest"],
	},
	{
		key: "rateRevision",
		routeId: "toolRateRevision",
		group: "borrowAndBuyHome",
		icon: RefreshCw,
		subgroup: "homeLoan",
		related: ["toolMortgage", "toolDebtToIncome", "toolEarlyRepayment"],
	},
	{
		key: "euribor",
		routeId: "toolEuribor",
		group: "borrowAndBuyHome",
		icon: ChartLine,
		subgroup: "homeLoan",
		related: ["toolRateRevision", "toolMortgage", "toolDebtToIncome"],
	},
	{
		key: "carLoan",
		routeId: "toolCarLoan",
		group: "borrowAndBuyHome",
		icon: Car,
		subgroup: "carAndPersonalLoans",
		related: ["toolHouseholdBudget", "toolPersonalLoan", "toolDebtToIncome", "toolVehicleTax"],
	},
	{
		key: "propertyTax",
		routeId: "toolPropertyTax",
		group: "borrowAndBuyHome",
		icon: Building,
		subgroup: "buyingAndTaxes",
		related: ["toolHouseholdBudget", "toolMortgage", "toolBuyVsRent"],
	},
	{
		key: "purchaseTaxes",
		routeId: "toolPurchaseTaxes",
		group: "borrowAndBuyHome",
		icon: Receipt,
		subgroup: "buyingAndTaxes",
		related: ["toolMortgage", "toolBorrowingCapacity", "toolSavingsGoal"],
	},
	{
		key: "youthMortgage",
		routeId: "toolYouthMortgage",
		group: "borrowAndBuyHome",
		icon: KeyRound,
		subgroup: "homeLoan",
		related: ["toolMortgage", "toolPurchaseTaxes", "toolSavingsGoal"],
	},
	{
		key: "vehicleTax",
		routeId: "toolVehicleTax",
		group: "borrowAndBuyHome",
		icon: CarFront,
		subgroup: "carAndPersonalLoans",
		related: ["toolCarLoan", "toolHouseholdBudget", "toolSavingsGoal"],
	},
	{
		key: "propertyCapitalGains",
		routeId: "toolPropertyCapitalGains",
		group: "borrowAndBuyHome",
		icon: HousePlus,
		subgroup: "buyingAndTaxes",
		related: ["toolPurchaseTaxes", "toolPropertyTax", "toolMortgage"],
	},
	{
		key: "personalLoan",
		routeId: "toolPersonalLoan",
		group: "borrowAndBuyHome",
		icon: HandCoins,
		subgroup: "carAndPersonalLoans",
		related: ["toolDebtToIncome", "toolHouseholdBudget", "toolEarlyRepayment"],
	},
	// Invest and grow
	{
		key: "compoundInterest",
		routeId: "toolCompoundInterest",
		group: "investAndGrow",
		icon: Sprout,
		subgroup: "investing",
		related: ["toolNetWorth", "toolSavingsRate", "toolInvestmentReturn"],
	},
	{
		key: "investmentReturn",
		routeId: "toolInvestmentReturn",
		group: "investAndGrow",
		icon: TrendingUp,
		subgroup: "investing",
		related: ["toolSp500History", "toolCompoundInterest", "toolNetWorth", "toolBrokerFees"],
	},
	{
		key: "sp500History",
		routeId: "toolSp500History",
		group: "investAndGrow",
		icon: History,
		subgroup: "investing",
		related: ["toolInvestmentReturn", "toolCompoundInterest", "toolInvestorProfile"],
	},
	{
		key: "investorProfile",
		routeId: "toolInvestorProfile",
		group: "investAndGrow",
		icon: UserCheck,
		subgroup: "investing",
		related: ["toolInvestmentReturn", "toolCompoundInterest", "toolEmergencyFund", "toolBrokerFees"],
	},
	{
		key: "fire",
		routeId: "pageFireCalculator",
		group: "investAndGrow",
		icon: Flame,
		subgroup: "retirement",
		related: ["toolCompoundInterest", "toolSavingsRate", "toolInvestmentReturn"],
	},
	{
		key: "statePension",
		routeId: "toolStatePension",
		group: "investAndGrow",
		icon: Hourglass,
		subgroup: "retirement",
		related: ["toolCompoundInterest", "toolInvestmentReturn", "toolNetSalary", "toolPprComparison"],
	},
	{
		key: "termDeposit",
		routeId: "toolTermDeposit",
		group: "investAndGrow",
		icon: Vault,
		subgroup: "depositsAndCertificates",
		related: ["toolCompoundInterest", "toolSavingsGoal", "toolEmergencyFund", "toolDepositRateIndex", "toolTermDepositOffers", "toolRemuneratedAccounts"],
	},
	{
		key: "savingsCertificates",
		routeId: "toolSavingsCertificates",
		group: "investAndGrow",
		icon: ScrollText,
		subgroup: "depositsAndCertificates",
		related: ["toolTermDeposit", "toolCompoundInterest", "toolInflation", "toolDepositRateIndex", "toolTermDepositOffers", "toolRemuneratedAccounts"],
	},
	{
		key: "depositRateIndex",
		routeId: "toolDepositRateIndex",
		group: "investAndGrow",
		icon: ChartColumn,
		subgroup: "depositsAndCertificates",
		related: ["toolTermDeposit", "toolSavingsCertificates", "toolInflation", "toolTermDepositOffers", "toolRemuneratedAccounts"],
	},
	{
		key: "termDepositOffers",
		routeId: "toolTermDepositOffers",
		group: "investAndGrow",
		icon: BadgePercent,
		comparator: true,
		related: ["toolTermDeposit", "toolDepositRateIndex", "toolSavingsCertificates", "toolRemuneratedAccounts"],
	},
	{
		key: "remuneratedAccounts",
		routeId: "toolRemuneratedAccounts",
		group: "investAndGrow",
		icon: PiggyBank,
		comparator: true,
		related: ["toolDepositRateIndex", "toolSavingsCertificates", "toolTermDeposit", "toolHouseholdBudget"],
	},
	{
		key: "brokerFees",
		routeId: "toolBrokerFees",
		group: "investAndGrow",
		icon: ChartCandlestick,
		comparator: true,
		related: ["toolCompoundInterest", "toolInvestmentReturn", "toolInvestorProfile", "toolNetWorth"],
	},
	{
		key: "pprComparison",
		routeId: "toolPprComparison",
		group: "investAndGrow",
		icon: Umbrella,
		comparator: true,
		related: ["toolStatePension", "toolCompoundInterest", "toolInvestorProfile", "toolBrokerFees"],
	},
	// Track your wealth
	{
		key: "netWorth",
		routeId: "toolNetWorth",
		group: "trackWealth",
		icon: Layers,
		related: ["toolCompoundInterest", "toolSavingsRate", "toolInvestmentReturn"],
	},
	{
		key: "goldPrice",
		routeId: "toolGoldPrice",
		group: "trackWealth",
		icon: Gem,
		related: ["toolNetWorth", "toolInflation", "toolInvestmentReturn"],
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

export interface ToolsMenuSection {
	/** The subgroup heading, or null for the tools listed under the group heading alone. */
	readonly subgroup: ToolSubgroupId | null
	readonly tools: readonly ToolsHubTool[]
}

export interface ToolsMenuGroup {
	readonly id: ToolGroupId
	readonly anchor: string
	readonly sections: readonly ToolsMenuSection[]
}

export interface HeaderToolMenus {
	/** The Tools menu: its columns, each a list of task groups split under their subgroups. */
	readonly columns: ReadonlyArray<readonly ToolsMenuGroup[]>
	/** The Comparators menu: every comparator, in the hub's order. */
	readonly comparators: readonly ToolsHubTool[]
}

/**
 * The header's Tools and Comparators menus for one locale, read from the hub's groups so the
 * links and positions match it. Comparators leave the Tools menu for their own. A tool whose
 * subgroup is missing or belongs to another group is listed under its group heading, so a slip
 * never drops a link (`toolsCatalog.test.ts` fails on it).
 */
export function buildHeaderToolMenus(lang: Lang, catalog: readonly ToolCatalogEntry[] = CATALOG): HeaderToolMenus {
	const hub = buildToolsHub(lang, catalog)
	const groups = new Map(
		hub.map((group): [ToolGroupId, ToolsMenuGroup] => {
			const tools = group.tools.filter((tool) => !tool.comparator)
			const subgroupIds = TOOL_SUBGROUPS.filter((subgroup) => subgroup.group === group.id).map(
				(subgroup) => subgroup.id as ToolSubgroupId,
			)
			const loose = tools.filter((tool) => !tool.subgroup || !subgroupIds.includes(tool.subgroup))
			const sections: ToolsMenuSection[] = [
				{ subgroup: null, tools: loose },
				...subgroupIds.map((subgroup) => ({
					subgroup,
					tools: tools.filter((tool) => tool.subgroup === subgroup),
				})),
			].filter((section) => section.tools.length > 0)

			return [group.id, { id: group.id, anchor: group.anchor, sections }]
		}),
	)

	return {
		columns: TOOLS_MENU_COLUMNS.map((column) =>
			column.map((id) => groups.get(id)!).filter((group) => group.sections.length > 0),
		).filter((column) => column.length > 0),
		comparators: hub.flatMap((group) => group.tools.filter((tool) => tool.comparator)),
	}
}

import {
	BookOpen,
	ChartCandlestick,
	ChartPie,
	Coins,
	CreditCard,
	FileText,
	FileUp,
	Landmark,
	Repeat,
	Scale,
	Server,
	Shield,
	Sparkles,
	Tag,
	Target,
	Users,
	type LucideIcon,
} from "lucide-react"
import { FEATURE_ROUTE_IDS } from "./routes"

export type FeatureRouteId = (typeof FEATURE_ROUTE_IDS)[number]

/** The column a feature sits in on the header's Features menu. */
export type FeatureMenuGroup = "everyday" | "wealth" | "trust"

export const FEATURE_MENU_GROUPS = ["everyday", "wealth", "trust"] as const satisfies readonly FeatureMenuGroup[]

export interface FeatureMenuItem {
	readonly routeId: FeatureRouteId
	readonly group: FeatureMenuGroup
	/** Copy key: `header.nav.<key>.name` and `header.nav.<key>.description` in every locale. */
	readonly key: string
	readonly icon: LucideIcon
}

/**
 * Every feature page, in the order the header's Features menu, the mobile drawer and the
 * footer's Features column show them, grouped: the menu shows one column per group, everyday
 * money on the left, then wealth, then trust and working together. Keep the items of a group
 * together, in reading order.
 *
 * Adding a feature page: add its route to `FEATURE_ROUTE_IDS`, one entry here and its `name` and
 * `description` under `header.nav.<key>` in every locale. `featureMenu.test.ts` fails until all
 * are done.
 */
export const FEATURE_MENU = [
	{ routeId: "featureAccounts", group: "everyday", key: "accounts", icon: Landmark },
	{ routeId: "featureBudgeting", group: "everyday", key: "budgeting", icon: BookOpen },
	{ routeId: "featureCategorization", group: "everyday", key: "categorization", icon: Tag },
	{ routeId: "featureRecurring", group: "everyday", key: "recurring", icon: Repeat },
	{ routeId: "featureGoals", group: "everyday", key: "goals", icon: Target },
	{ routeId: "featureReports", group: "everyday", key: "reports", icon: FileText },
	{ routeId: "featureNetWorth", group: "wealth", key: "netWorth", icon: Scale },
	{ routeId: "featurePortfolio", group: "wealth", key: "portfolio", icon: ChartPie },
	{ routeId: "featureFinancialMarkets", group: "wealth", key: "financialMarkets", icon: ChartCandlestick },
	{ routeId: "featureCredits", group: "wealth", key: "credits", icon: CreditCard },
	{ routeId: "featureMultiCurrency", group: "wealth", key: "multiCurrency", icon: Coins },
	{ routeId: "featureHousehold", group: "trust", key: "household", icon: Users },
	{ routeId: "featureImports", group: "trust", key: "imports", icon: FileUp },
	{ routeId: "featureAssistant", group: "trust", key: "assistant", icon: Sparkles },
	{ routeId: "featurePrivacy", group: "trust", key: "privacy", icon: Shield },
	{ routeId: "featureSelfHosting", group: "trust", key: "selfHosting", icon: Server },
] as const satisfies readonly FeatureMenuItem[]

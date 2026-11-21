import {
	BookOpen,
	ChartCandlestick,
	ChartPie,
	CreditCard,
	FileText,
	Landmark,
	Scale,
	Shield,
	Tag,
	Target,
	type LucideIcon,
} from "lucide-react"
import { FEATURE_ROUTE_IDS } from "./routes"

export type FeatureRouteId = (typeof FEATURE_ROUTE_IDS)[number]

export interface FeatureMenuItem {
	readonly routeId: FeatureRouteId
	/** Copy key: `header.nav.<key>.name` and `header.nav.<key>.description` in every locale. */
	readonly key: string
	readonly icon: LucideIcon
}

/**
 * Every feature page, in the order the header's Features menu, the mobile drawer and the
 * footer's Features column show them. The menu lays them out in two columns, row by row, so
 * the left column reads as the everyday money features and the right as wealth and trust.
 *
 * Adding a feature page: add its route to `FEATURE_ROUTE_IDS`, one entry here and its `name` and
 * `description` under `header.nav.<key>` in every locale. `featureMenu.test.ts` fails until all
 * are done.
 */
export const FEATURE_MENU = [
	{ routeId: "featureAccounts", key: "accounts", icon: Landmark },
	{ routeId: "featureNetWorth", key: "netWorth", icon: Scale },
	{ routeId: "featureBudgeting", key: "budgeting", icon: BookOpen },
	{ routeId: "featurePortfolio", key: "portfolio", icon: ChartPie },
	{ routeId: "featureCategorization", key: "categorization", icon: Tag },
	{ routeId: "featureFinancialMarkets", key: "financialMarkets", icon: ChartCandlestick },
	{ routeId: "featureGoals", key: "goals", icon: Target },
	{ routeId: "featureCredits", key: "credits", icon: CreditCard },
	{ routeId: "featureReports", key: "reports", icon: FileText },
	{ routeId: "featurePrivacy", key: "privacy", icon: Shield },
] as const satisfies readonly FeatureMenuItem[]

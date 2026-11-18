// Historical aliases for the Vercel redirects and sitemap filter.
import {
	FEATURE_ROUTE_IDS,
	SUPPORTED_LANGS,
	TOOL_ROUTE_IDS,
	TOP_LEVEL_PAGE_ROUTE_IDS,
	getLocalizedSlug,
	toLocalizedPath,
	type Lang,
	type RouteId,
} from "./routes.ts"

type TopLevelRouteId = (typeof TOP_LEVEL_PAGE_ROUTE_IDS)[number]
type FeatureRouteId = (typeof FEATURE_ROUTE_IDS)[number]
type ToolRouteId = (typeof TOOL_ROUTE_IDS)[number]

export const LEGACY_TOP_LEVEL_PAGE_SLUG_BY_ROUTE_ID: Partial<Record<TopLevelRouteId, string>> = {
	pageAbout: "about",
	pageEtfTracker: "etf-tracker",
	pagePortfolioTracker: "portfolio-tracker",
	pageNetWorthTracker: "net-worth-tracker",
	pageYnabAlternative: "ynab-alternative",
	pageFireCalculator: "fire-calculator",
}

export const LEGACY_FEATURE_SLUG_BY_ROUTE_ID: Record<FeatureRouteId, string> = {
	featureAccounts: "accounts",
	featureBudgeting: "budgeting",
	featureCategorization: "categorization",
	featureCredits: "loans",
	featureFinancialMarkets: "financial-markets",
	featureGoals: "goals",
	featureNetWorth: "net-worth",
	featurePrivacy: "privacy",
	featurePortfolio: "portfolio",
	featureReports: "reports",
}

// Only tools that once lived at an English slug have one; new tools start at
// their localized slug and need no alias.
export const LEGACY_TOOL_SLUG_BY_ROUTE_ID: Partial<Record<ToolRouteId, string>> = {
	toolCompoundInterest: "compound-interest-calculator",
	toolNetWorth: "net-worth-calculator",
	toolSavingsRate: "savings-rate-calculator",
	toolInvestmentReturn: "investment-return-calculator",
	toolMortgage: "mortgage-calculator",
}

/** The legacy slug of a page in a locale, or undefined when the page has none there. */
function getLegacySlug(
	legacySlugByRouteId: Partial<Record<RouteId, string>>,
	routeId: RouteId,
	locale: Lang,
): string | undefined {
	const legacySlug = legacySlugByRouteId[routeId]
	return legacySlug && legacySlug !== getLocalizedSlug(routeId, locale) ? legacySlug : undefined
}

export type LegacyRedirect = { source: string; destination: string }

const LEGACY_SECTIONS: ReadonlyArray<{
	prefix: string
	routeIds: ReadonlyArray<RouteId>
	legacySlugByRouteId: Partial<Record<RouteId, string>>
}> = [
	{ prefix: "", routeIds: TOP_LEVEL_PAGE_ROUTE_IDS, legacySlugByRouteId: LEGACY_TOP_LEVEL_PAGE_SLUG_BY_ROUTE_ID },
	{ prefix: "features/", routeIds: FEATURE_ROUTE_IDS, legacySlugByRouteId: LEGACY_FEATURE_SLUG_BY_ROUTE_ID },
	{ prefix: "tools/", routeIds: TOOL_ROUTE_IDS, legacySlugByRouteId: LEGACY_TOOL_SLUG_BY_ROUTE_ID },
]

/** Every legacy address that redirects, with the localized address it redirects to. */
export function getLegacyRedirects(locales: ReadonlyArray<Lang> = SUPPORTED_LANGS): LegacyRedirect[] {
	return locales.flatMap((locale) =>
		LEGACY_SECTIONS.flatMap(({ prefix, routeIds, legacySlugByRouteId }) =>
			routeIds.flatMap((routeId) => {
				const legacySlug = getLegacySlug(legacySlugByRouteId, routeId, locale)
				return legacySlug
					? [
							{
								source: `/${locale}/${prefix}${legacySlug}`,
								destination: toLocalizedPath(routeId, locale),
							},
						]
					: []
			}),
		),
	)
}

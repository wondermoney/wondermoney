import {
	SUPPORTED_LANGS,
	type Lang,
	toLang,
} from "./i18nLocale"

type LocalizedSlugByLang = Record<Lang, string>

const ROUTE_SLUGS = {
	pagePricing: {
		pt: "precos",
		en: "pricing",
		es: "precios",
		fr: "tarifs",
		de: "preise",
		it: "prezzi",
	},
	pageAbout: {
		pt: "sobre",
		en: "about",
		es: "acerca",
		fr: "a-propos",
		de: "uber-uns",
		it: "chi-siamo",
	},
	pageEtfTracker: {
		pt: "rastreador-etf",
		en: "etf-tracker",
		es: "rastreador-etf",
		fr: "suivi-etf",
		de: "etf-tracker",
		it: "tracker-etf",
	},
	pagePortfolioTracker: {
		pt: "rastreador-carteira",
		en: "portfolio-tracker",
		es: "rastreador-cartera",
		fr: "suivi-portefeuille",
		de: "portfolio-tracker",
		it: "tracker-portafoglio",
	},
	pageNetWorthTracker: {
		pt: "rastreador-patrimonio-liquido",
		en: "net-worth-tracker",
		es: "rastreador-patrimonio-neto",
		fr: "suivi-patrimoine-net",
		de: "nettovermogen-tracker",
		it: "tracker-patrimonio-netto",
	},
	pageYnabAlternative: {
		pt: "alternativa-ynab",
		en: "ynab-alternative",
		es: "alternativa-ynab",
		fr: "alternative-ynab",
		de: "ynab-alternative",
		it: "alternativa-ynab",
	},
	pageFireCalculator: {
		pt: "calculadora-fire",
		en: "fire-calculator",
		es: "calculadora-fire",
		fr: "calculateur-fire",
		de: "fire-rechner",
		it: "calcolatore-fire",
	},
	pageHowToCalculateNetWorth: {
		pt: "como-calcular-patrimonio-liquido",
		en: "how-to-calculate-net-worth",
		es: "como-calcular-patrimonio-neto",
		fr: "comment-calculer-patrimoine-net",
		de: "nettovermoegen-berechnen",
		it: "come-calcolare-patrimonio-netto",
	},
	alternativaExcel: {
		pt: "alternativa-excel",
		en: "excel-alternative",
		es: "alternativa-excel",
		fr: "alternative-excel",
		de: "excel-alternative",
		it: "alternativa-excel",
	},
	appFinancasPortugal: {
		pt: "app-financas-portugal",
		en: "personal-finance-app-portugal",
		es: "app-finanzas-personales",
		fr: "app-finances-personnelles",
		de: "persoenliche-finanz-app",
		it: "app-finanze-personali",
	},
	controloGastos: {
		pt: "controlo-gastos",
		en: "expense-tracker",
		es: "control-gastos",
		fr: "suivi-depenses",
		de: "ausgaben-verfolgen",
		it: "controllo-spese",
	},
	gestaoFinanceira: {
		pt: "gestao-financeira",
		en: "personal-financial-management",
		es: "gestion-financiera",
		fr: "gestion-financiere",
		de: "finanzverwaltung",
		it: "gestione-finanziaria",
	},
	// Lead-magnet guide page, gated behind the email capture form.
	guideMoneyCheckin: {
		pt: "guia-verificacao-patrimonio-10-minutos",
		en: "10-minute-net-worth-check-in-guide",
		es: "guia-patrimonio-neto-10-minutos",
		fr: "guide-patrimoine-net-10-minutes",
		de: "leitfaden-nettovermoegen-10-minuten",
		it: "guida-patrimonio-netto-10-minuti",
	},
	featureAccounts: {
		pt: "contas",
		en: "accounts",
		es: "cuentas",
		fr: "comptes",
		de: "konten",
		it: "conti",
	},
	featureNetWorth: {
		pt: "patrimonio-liquido",
		en: "net-worth",
		es: "patrimonio-neto",
		fr: "patrimoine-net",
		de: "nettovermoegen",
		it: "patrimonio-netto",
	},
	featureFinancialMarkets: {
		pt: "mercados-financeiros",
		en: "financial-markets",
		es: "mercados-financieros",
		fr: "marches-financiers",
		de: "finanzmaerkte",
		it: "mercati-finanziari",
	},
	featureGoals: {
		pt: "metas",
		en: "goals",
		es: "metas",
		fr: "objectifs",
		de: "ziele",
		it: "obiettivi",
	},
	featureCredits: {
		pt: "emprestimos",
		en: "loans",
		es: "prestamos",
		fr: "prets",
		de: "kredite",
		it: "prestiti",
	},
	featureBudgeting: {
		pt: "orcamentos",
		en: "budgeting",
		es: "presupuestos",
		fr: "budgetisation",
		de: "budgetierung",
		it: "budgeting",
	},
	featureCategorization: {
		pt: "categorizacao",
		en: "categorization",
		es: "categorizacion",
		fr: "categorisation",
		de: "kategorisierung",
		it: "categorizzazione",
	},
	featurePrivacy: {
		pt: "privacidade",
		en: "privacy",
		es: "privacidad",
		fr: "confidentialite",
		de: "datenschutz",
		it: "privacy",
	},
	featurePortfolio: {
		pt: "carteira",
		en: "portfolio",
		es: "cartera",
		fr: "portefeuille",
		de: "portfolio",
		it: "portafoglio",
	},
	featureReports: {
		pt: "relatorios",
		en: "reports",
		es: "informes",
		fr: "rapports",
		de: "berichte",
		it: "report",
	},
	toolCompoundInterest: {
		pt: "juros-compostos",
		en: "compound-interest-calculator",
		es: "interes-compuesto",
		fr: "interets-composes",
		de: "zinseszins-rechner",
		it: "interesse-composto",
	},
	toolNetWorth: {
		pt: "patrimonio-liquido",
		en: "net-worth-calculator",
		es: "patrimonio-neto",
		fr: "patrimoine-net",
		de: "nettovermogen-rechner",
		it: "patrimonio-netto",
	},
	toolSavingsRate: {
		pt: "taxa-poupanca",
		en: "savings-rate-calculator",
		es: "tasa-ahorro",
		fr: "taux-epargne",
		de: "sparquote-rechner",
		it: "tasso-risparmio",
	},
	toolInvestmentReturn: {
		pt: "retorno-investimento",
		en: "investment-return-calculator",
		es: "rendimiento-inversion",
		fr: "rendement-investissement",
		de: "anlagerendite-rechner",
		it: "rendimento-investimento",
	},
	pagePersonalFinanceApp: {
		pt: "app-de-financas-pessoais",
		en: "personal-finance-app",
		es: "aplicacion-finanzas-personales",
		fr: "application-finances-personnelles",
		de: "app-fuer-persoenliche-finanzen",
		it: "app-per-finanze-personali",
	},
	pageOpenBankingApp: {
		pt: "app-open-banking",
		en: "open-banking-app",
		es: "app-open-banking",
		fr: "application-open-banking",
		de: "open-banking-app",
		it: "app-open-banking",
	},
	pageBudgetApp: {
		pt: "app-de-orcamento",
		en: "budget-app",
		es: "app-de-presupuesto",
		fr: "application-de-budget",
		de: "budget-app",
		it: "app-di-budget",
	},
	adNetWorth: {
		pt: "quanto-vales",
		en: "know-your-worth",
		es: "cuanto-vales",
		fr: "combien-vaux-tu",
		de: "was-bist-du-wert",
		it: "quanto-vali",
	},
	adFragmentation: {
		pt: "tudo-num-so-lugar",
		en: "one-place",
		es: "todo-en-un-lugar",
		fr: "tout-au-meme-endroit",
		de: "alles-an-einem-ort",
		it: "tutto-in-un-posto",
	},
	adOpenBanking: {
		pt: "open-banking",
		en: "open-banking",
		es: "open-banking",
		fr: "open-banking",
		de: "open-banking",
		it: "open-banking",
	},
} as const satisfies Record<string, LocalizedSlugByLang>

export type RouteId = keyof typeof ROUTE_SLUGS

export const TOP_LEVEL_PAGE_ROUTE_IDS = [
	"pageAbout",
	"pageEtfTracker",
	"pagePortfolioTracker",
	"pageNetWorthTracker",
	"pageYnabAlternative",
	"pageFireCalculator",
	"pageHowToCalculateNetWorth",
	"pagePersonalFinanceApp",
	"pageOpenBankingApp",
	"pageBudgetApp",
] as const satisfies ReadonlyArray<RouteId>

// Top-level pages with their own route file in each locale tree, named by the
// localized slug (`src/pages/{lang}/{slug}.astro`). They used to be served under
// the Portuguese slug in every locale too; vercel.json now 301s those addresses
// to the localized slug.
export const STANDALONE_PAGE_ROUTE_IDS = [
	"alternativaExcel",
	"appFinancasPortugal",
	"controloGastos",
	"gestaoFinanceira",
] as const satisfies ReadonlyArray<RouteId>

export type StandalonePageRouteId = (typeof STANDALONE_PAGE_ROUTE_IDS)[number]

// Other top-level pages with their own route file in each locale tree, such as
// the lead-magnet guide. Listed so the language switcher maps their slugs too.
const OTHER_TOP_LEVEL_ROUTE_IDS = [
	"guideMoneyCheckin",
] as const satisfies ReadonlyArray<RouteId>

export const FEATURE_ROUTE_IDS = [
	"featureAccounts",
	"featureBudgeting",
	"featureCategorization",
	"featureCredits",
	"featureFinancialMarkets",
	"featureGoals",
	"featureNetWorth",
	"featurePrivacy",
	"featurePortfolio",
	"featureReports",
] as const satisfies ReadonlyArray<RouteId>

export const TOOL_ROUTE_IDS = [
	"toolCompoundInterest",
	"toolNetWorth",
	"toolSavingsRate",
	"toolInvestmentReturn",
] as const satisfies ReadonlyArray<RouteId>

export type ToolRouteId = (typeof TOOL_ROUTE_IDS)[number]

// Paid-traffic ad landing pages (message-matched to Meta ad angles). Kept in a
// distinct `/go/` namespace and always rendered noindex,follow so they never
// compete with the equivalent SEO pages for organic rankings.
export const AD_LANDING_ROUTE_IDS = [
	"adNetWorth",
	"adFragmentation",
	"adOpenBanking",
] as const satisfies ReadonlyArray<RouteId>

export type AdLandingRouteId = (typeof AD_LANDING_ROUTE_IDS)[number]

const FEATURE_ROUTE_ID_SET = new Set<RouteId>(FEATURE_ROUTE_IDS)
const TOOL_ROUTE_ID_SET = new Set<RouteId>(TOOL_ROUTE_IDS)
const AD_LANDING_ROUTE_ID_SET = new Set<RouteId>(AD_LANDING_ROUTE_IDS)

export { SUPPORTED_LANGS, toLang }
export type { Lang }

export function getLocalizedSlug(routeId: RouteId, lang: Lang): string {
	const route = ROUTE_SLUGS[routeId]

	if (!route) {
		throw new Error(`Unknown route id: ${String(routeId)}`)
	}

	return route[lang]
}

export function toLocalizedPath(routeId: RouteId, lang: Lang): string {
	const slug = getLocalizedSlug(routeId, lang)

	if (FEATURE_ROUTE_ID_SET.has(routeId)) {
		return `/${lang}/features/${slug}`
	}

	if (TOOL_ROUTE_ID_SET.has(routeId)) {
		return `/${lang}/tools/${slug}`
	}

	if (AD_LANDING_ROUTE_ID_SET.has(routeId)) {
		return `/${lang}/go/${slug}`
	}

	return `/${lang}/${slug}`
}

export function toToolsHubPath(lang: Lang): string {
	return `/${lang}/tools`
}

const SITE_URL = "https://wonder.money"
const DEFAULT_LANG: Lang = "pt"

export function buildAlternateLinksForPath(
	pathByLang: (lang: Lang) => string,
): Array<{ hrefLang: string; href: string }> {
	const links = SUPPORTED_LANGS.map((lang) => ({
		hrefLang: lang,
		href: `${SITE_URL}${pathByLang(lang)}`,
	}))

	return [
		...links,
		{ hrefLang: "x-default", href: `${SITE_URL}${pathByLang(DEFAULT_LANG)}` },
	]
}

export function buildAlternateLinks(
	routeId: RouteId,
): Array<{ hrefLang: string; href: string }> {
	return buildAlternateLinksForPath((lang) => toLocalizedPath(routeId, lang))
}

function parsePathname(pathname: string): {
	lang: Lang
	segments: string[]
	hasPrefix: boolean
} {
	const normalized = pathname.split(/[?#]/)[0] || "/"
	const segments = normalized.split("/").filter(Boolean)
	const firstSegment = segments[0]
	const hasPrefix = SUPPORTED_LANGS.includes(firstSegment as Lang)
	const lang = hasPrefix ? (firstSegment as Lang) : "pt"

	return {
		lang,
		segments: hasPrefix ? segments.slice(1) : segments,
		hasPrefix,
	}
}

export function toLocalizedPathname(pathname: string, nextLang: Lang): string {
	const { lang: currentLang, segments } = parsePathname(pathname)

	if (segments.length === 0) {
		return `/${nextLang}`
	}

	const [first, second, ...rest] = segments

	if (first === "features" && second) {
		try {
			const routeId = resolveFeatureRouteId(currentLang, second)
			const localizedSlug = getLocalizedSlug(routeId, nextLang)
			const suffix = rest.length > 0 ? `/${rest.join("/")}` : ""
			return `/${nextLang}/features/${localizedSlug}${suffix}`
		} catch {
			return `/${nextLang}/features/${second}${rest.length > 0 ? `/${rest.join("/")}` : ""}`
		}
	}

	if (first === "tools" && second) {
		try {
			const routeId = resolveToolRouteId(currentLang, second)
			const localizedSlug = getLocalizedSlug(routeId, nextLang)
			const suffix = rest.length > 0 ? `/${rest.join("/")}` : ""
			return `/${nextLang}/tools/${localizedSlug}${suffix}`
		} catch {
			return `/${nextLang}/tools/${second}${rest.length > 0 ? `/${rest.join("/")}` : ""}`
		}
	}

	if (first === "go" && second) {
		try {
			const routeId = resolveAdLandingRouteId(currentLang, second)
			const localizedSlug = getLocalizedSlug(routeId, nextLang)
			const suffix = rest.length > 0 ? `/${rest.join("/")}` : ""
			return `/${nextLang}/go/${localizedSlug}${suffix}`
		} catch {
			return `/${nextLang}/go/${second}${rest.length > 0 ? `/${rest.join("/")}` : ""}`
		}
	}

	if (first === "learn" || first === "glossary") {
		return `/${nextLang}/${segments.join("/")}`
	}

	const [slug, ...tail] = segments
	try {
		const routeId = resolveRouteIdFor(
			[
				...TOP_LEVEL_PAGE_ROUTE_IDS,
				...STANDALONE_PAGE_ROUTE_IDS,
				...OTHER_TOP_LEVEL_ROUTE_IDS,
			],
			currentLang,
			slug,
		)
		const localizedSlug = getLocalizedSlug(routeId, nextLang)
		const suffix = tail.length > 0 ? `/${tail.join("/")}` : ""
		return `/${nextLang}/${localizedSlug}${suffix}`
	} catch {
		return `/${nextLang}/${segments.join("/")}`
	}
}

function resolveRouteIdFor(
	ids: ReadonlyArray<RouteId>,
	lang: Lang,
	slug: string,
): RouteId {
	const routeId = ids.find((candidate) => getLocalizedSlug(candidate, lang) === slug)

	if (!routeId) {
		throw new Error(`Unknown localized slug for ${lang}: ${slug}`)
	}

	return routeId
}

export function resolveTopLevelPageRouteId(lang: Lang, slug: string): RouteId {
	return resolveRouteIdFor(TOP_LEVEL_PAGE_ROUTE_IDS, lang, slug)
}

export function resolveFeatureRouteId(lang: Lang, slug: string): RouteId {
	return resolveRouteIdFor(FEATURE_ROUTE_IDS, lang, slug)
}

export function resolveToolRouteId(lang: Lang, slug: string): RouteId {
	return resolveRouteIdFor(TOOL_ROUTE_IDS, lang, slug)
}

export function resolveAdLandingRouteId(lang: Lang, slug: string): RouteId {
	return resolveRouteIdFor(AD_LANDING_ROUTE_IDS, lang, slug)
}

const LEGACY_TOOL_ROUTE_ID_BY_KEY: Record<string, ToolRouteId> = {
	toolcompoundinterest: "toolCompoundInterest",
	compoundinterestcalculator: "toolCompoundInterest",
	"compound-interest-calculator": "toolCompoundInterest",
	"juros-compostos": "toolCompoundInterest",
	toolnetworth: "toolNetWorth",
	networthcalculator: "toolNetWorth",
	"net-worth-calculator": "toolNetWorth",
	"patrimonio-liquido": "toolNetWorth",
	toolsavingsrate: "toolSavingsRate",
	savingsratecalculator: "toolSavingsRate",
	"savings-rate-calculator": "toolSavingsRate",
	"taxa-poupanca": "toolSavingsRate",
	toolinvestmentreturn: "toolInvestmentReturn",
	investmentreturncalculator: "toolInvestmentReturn",
	"investment-return-calculator": "toolInvestmentReturn",
	"retorno-investimento": "toolInvestmentReturn",
}

function normalizeRouteLookupKey(value: string): string {
	const token = value
		.trim()
		.split(/[?#]/)[0]
		.split("/")
		.filter(Boolean)
		.pop() ?? value

	return token
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replace(/[\s_]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/[^a-zA-Z0-9-]/g, "")
		.toLowerCase()
}

export function resolveToolRouteIdFromLegacy(
	value: string | null | undefined,
	lang: Lang,
): ToolRouteId | undefined {
	if (!value) {
		return undefined
	}

	if ((TOOL_ROUTE_IDS as readonly string[]).includes(value)) {
		return value as ToolRouteId
	}

	const normalized = normalizeRouteLookupKey(value)
	const directMatch = LEGACY_TOOL_ROUTE_ID_BY_KEY[normalized]

	if (directMatch) {
		return directMatch
	}

	for (const routeId of TOOL_ROUTE_IDS) {
		if (normalizeRouteLookupKey(getLocalizedSlug(routeId, lang)) === normalized) {
			return routeId
		}
	}

	return undefined
}

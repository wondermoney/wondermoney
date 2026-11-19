import {
	SUPPORTED_LANGS,
	type Lang,
	toLang,
} from "./i18nLocale.ts"

type LocalizedSlugByLang = Record<Lang, string>

const ROUTE_SLUGS = {
	pageResources: {
		pt: "recursos",
		en: "resources",
		es: "recursos",
		fr: "ressources",
		de: "ressourcen",
		it: "risorse",
	},
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
	pageGuidedStart: {
		pt: "por-onde-comecar",
		en: "where-to-start",
		es: "por-donde-empezar",
		fr: "par-ou-commencer",
		de: "wo-anfangen",
		it: "da-dove-iniziare",
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
	toolInvestorProfile: {
		pt: "perfil-investidor",
		en: "investor-profile-quiz",
		es: "perfil-inversor",
		fr: "profil-investisseur",
		de: "anlegerprofil-test",
		it: "profilo-investitore",
	},
	toolDebtToIncome: {
		pt: "taxa-de-esforco",
		en: "debt-to-income-calculator",
		es: "ratio-endeudamiento",
		fr: "taux-endettement",
		de: "schuldendienstquote-rechner",
		it: "rapporto-rata-reddito",
	},
	toolEmergencyFund: {
		pt: "fundo-de-emergencia",
		en: "emergency-fund-calculator",
		es: "fondo-de-emergencia",
		fr: "epargne-de-precaution",
		de: "notgroschen-rechner",
		it: "fondo-di-emergenza",
	},
	toolMortgage: {
		pt: "credito-habitacao",
		en: "mortgage-calculator",
		es: "hipoteca",
		fr: "pret-immobilier",
		de: "hypotheken-rechner",
		it: "mutuo-casa",
	},
	toolEarlyRepayment: {
		pt: "simulador-amortizacao-credito",
		en: "early-repayment-calculator",
		es: "amortizacion-anticipada",
		fr: "remboursement-anticipe",
		de: "sondertilgung-rechner",
		it: "estinzione-anticipata",
	},
	toolMortgageTransfer: {
		pt: "simulador-transferencia-credito-habitacao",
		en: "mortgage-switch-calculator",
		es: "cambiar-hipoteca-de-banco",
		fr: "rachat-credit-immobilier",
		de: "umschuldung-rechner",
		it: "surroga-mutuo",
	},
	toolHouseholdBudget: {
		pt: "orcamento-familiar",
		en: "household-budget-calculator",
		es: "presupuesto-familiar",
		fr: "budget-familial",
		de: "haushaltsbudget-rechner",
		it: "budget-familiare",
	},
	toolSavingsGoal: {
		pt: "simulador-poupanca",
		en: "savings-goal-calculator",
		es: "simulador-ahorro",
		fr: "simulateur-epargne",
		de: "sparziel-rechner",
		it: "simulatore-risparmio",
	},
	toolTermDeposit: {
		pt: "calculadora-depositos-a-prazo",
		en: "term-deposit-calculator",
		es: "calculadora-deposito-a-plazo",
		fr: "calculateur-depot-a-terme",
		de: "festgeld-rechner",
		it: "calcolatore-conto-deposito",
	},
	toolBuyVsRent: {
		pt: "comprar-ou-arrendar-casa",
		en: "rent-vs-buy-calculator",
		es: "comprar-o-alquilar-vivienda",
		fr: "acheter-ou-louer",
		de: "kaufen-oder-mieten-rechner",
		it: "comprare-o-affittare-casa",
	},
	toolBorrowingCapacity: {
		pt: "quanto-posso-pedir-emprestado",
		en: "how-much-can-i-borrow",
		es: "cuanto-puedo-pedir-prestado",
		fr: "combien-puis-je-emprunter",
		de: "wie-viel-kredit-bekomme-ich",
		it: "quanto-mutuo-posso-chiedere",
	},
	toolRateRevision: {
		pt: "simulador-revisao-taxa-credito",
		en: "variable-rate-payment-calculator",
		es: "simulador-revision-tipo-interes",
		fr: "simulateur-revision-taux-variable",
		de: "zinsanpassung-rechner",
		it: "simulatore-rata-mutuo-variabile",
	},
	toolCarLoan: {
		pt: "simulador-credito-automovel",
		en: "car-loan-calculator",
		es: "simulador-prestamo-coche",
		fr: "simulateur-credit-auto",
		de: "autokredit-rechner",
		it: "simulatore-prestito-auto",
	},
	toolSavingsCertificates: {
		pt: "simulador-certificados-de-aforro",
		en: "savings-certificates-calculator",
		es: "simulador-certificados-de-ahorro-portugal",
		fr: "simulateur-certificats-epargne-portugal",
		de: "sparzertifikate-portugal-rechner",
		it: "simulatore-certificati-risparmio-portogallo",
	},
	toolPersonalLoan: {
		pt: "simulador-credito-pessoal",
		en: "personal-loan-calculator",
		es: "simulador-prestamo-personal",
		fr: "simulateur-pret-personnel",
		de: "privatkredit-rechner",
		it: "calcolo-prestito-personale",
	},
	toolInflation: {
		pt: "calculadora-inflacao-portugal",
		en: "portugal-inflation-calculator",
		es: "calculadora-inflacion-portugal",
		fr: "calculateur-inflation-portugal",
		de: "inflationsrechner-portugal",
		it: "calcolo-inflazione-portogallo",
	},
	toolPropertyTax: {
		pt: "simulador-imi",
		en: "imi-property-tax-calculator",
		es: "calculadora-imi-portugal",
		fr: "calculateur-imi-portugal",
		de: "imi-rechner-portugal",
		it: "calcolatore-imi-portogallo",
	},
	toolPurchaseTaxes: {
		pt: "simulador-imt-imposto-selo",
		en: "property-purchase-taxes-calculator",
		es: "calculadora-impuestos-compra-vivienda-portugal",
		fr: "simulateur-taxes-achat-immobilier-portugal",
		de: "immobilienkaufsteuern-portugal-rechner",
		it: "calcolo-imposte-acquisto-casa-portogallo",
	},
	toolYouthMortgage: {
		pt: "simulador-credito-habitacao-jovem",
		en: "youth-mortgage-calculator-portugal",
		es: "calculadora-hipoteca-joven-portugal",
		fr: "simulateur-credit-immobilier-jeune-portugal",
		de: "jugend-immobilienkredit-portugal-rechner",
		it: "calcolo-mutuo-giovani-portogallo",
	},
	toolNetSalary: {
		pt: "simulador-salario-liquido",
		en: "portugal-net-salary-calculator",
		es: "calculadora-salario-neto-portugal",
		fr: "calculateur-salaire-net-portugal",
		de: "nettogehalt-rechner-portugal",
		it: "calcolatore-stipendio-netto-portogallo",
	},
	toolWithholdingTables: {
		pt: "tabelas-retencao-irs-2026",
		en: "portugal-irs-withholding-tables",
		es: "tablas-retencion-irs-portugal",
		fr: "baremes-retenue-source-irs-portugal",
		de: "irs-quellensteuer-tabellen-portugal",
		it: "tabelle-ritenuta-irs-portogallo",
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
	"pageGuidedStart",
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
	"pageResources",
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
	"toolInvestorProfile",
	"toolDebtToIncome",
	"toolEmergencyFund",
	"toolMortgage",
	"toolHouseholdBudget",
	"toolSavingsGoal",
	"toolTermDeposit",
	"toolEarlyRepayment",
	"toolBuyVsRent",
	"toolBorrowingCapacity",
	"toolMortgageTransfer",
	"toolRateRevision",
	"toolCarLoan",
	"toolPersonalLoan",
	"toolInflation",
	"toolSavingsCertificates",
	"toolPropertyTax",
	"toolPurchaseTaxes",
	"toolYouthMortgage",
	"toolNetSalary",
	"toolWithholdingTables",
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
	tooldebttoincome: "toolDebtToIncome",
	debttoincomecalculator: "toolDebtToIncome",
	"debt-to-income-calculator": "toolDebtToIncome",
	"taxa-de-esforco": "toolDebtToIncome",
	toolemergencyfund: "toolEmergencyFund",
	emergencyfundcalculator: "toolEmergencyFund",
	"emergency-fund-calculator": "toolEmergencyFund",
	"emergency-fund": "toolEmergencyFund",
	"fundo-de-emergencia": "toolEmergencyFund",
	toolmortgage: "toolMortgage",
	mortgagecalculator: "toolMortgage",
	"mortgage-calculator": "toolMortgage",
	"loan-calculator": "toolMortgage",
	"credito-habitacao": "toolMortgage",
	toolhouseholdbudget: "toolHouseholdBudget",
	householdbudgetcalculator: "toolHouseholdBudget",
	"household-budget-calculator": "toolHouseholdBudget",
	"orcamento-familiar": "toolHouseholdBudget",
	toolsavingsgoal: "toolSavingsGoal",
	savingsgoalcalculator: "toolSavingsGoal",
	"savings-goal-calculator": "toolSavingsGoal",
	"savings-goal": "toolSavingsGoal",
	"simulador-poupanca": "toolSavingsGoal",
	tooltermdeposit: "toolTermDeposit",
	termdepositcalculator: "toolTermDeposit",
	"term-deposit-calculator": "toolTermDeposit",
	"term-deposit": "toolTermDeposit",
	"calculadora-depositos-a-prazo": "toolTermDeposit",
	"depositos-a-prazo": "toolTermDeposit",
	"deposito-a-prazo": "toolTermDeposit",
	toolearlyrepayment: "toolEarlyRepayment",
	earlyrepaymentcalculator: "toolEarlyRepayment",
	"early-repayment-calculator": "toolEarlyRepayment",
	"simulador-amortizacao-credito": "toolEarlyRepayment",
	toolbuyvsrent: "toolBuyVsRent",
	"buy-vs-rent": "toolBuyVsRent",
	"rent-vs-buy-calculator": "toolBuyVsRent",
	"comprar-ou-arrendar-casa": "toolBuyVsRent",
	toolborrowingcapacity: "toolBorrowingCapacity",
	borrowingcapacitycalculator: "toolBorrowingCapacity",
	"borrowing-capacity-calculator": "toolBorrowingCapacity",
	"borrowing-capacity": "toolBorrowingCapacity",
	"how-much-can-i-borrow": "toolBorrowingCapacity",
	"quanto-posso-pedir-emprestado": "toolBorrowingCapacity",
	toolmortgagetransfer: "toolMortgageTransfer",
	mortgagetransfercalculator: "toolMortgageTransfer",
	"mortgage-transfer-calculator": "toolMortgageTransfer",
	"mortgage-switch-calculator": "toolMortgageTransfer",
	"mortgage-transfer": "toolMortgageTransfer",
	"simulador-transferencia-credito-habitacao": "toolMortgageTransfer",
	toolraterevision: "toolRateRevision",
	raterevisioncalculator: "toolRateRevision",
	"rate-revision-calculator": "toolRateRevision",
	"rate-revision": "toolRateRevision",
	"variable-rate-payment-calculator": "toolRateRevision",
	"simulador-revisao-taxa-credito": "toolRateRevision",
	toolcarloan: "toolCarLoan",
	carloancalculator: "toolCarLoan",
	"car-loan": "toolCarLoan",
	"credito-automovel": "toolCarLoan",
	toolinflation: "toolInflation",
	"inflation-calculator": "toolInflation",
	toolsavingscertificates: "toolSavingsCertificates",
	"certificados-de-aforro": "toolSavingsCertificates",
	"certificados-de-aforro-serie-f": "toolSavingsCertificates",
	"savings-certificates": "toolSavingsCertificates",
	toolpurchasetaxes: "toolPurchaseTaxes",
	"imt-calculator": "toolPurchaseTaxes",
	"simulador-imt": "toolPurchaseTaxes",
	toolyouthmortgage: "toolYouthMortgage",
	"credito-habitacao-jovem": "toolYouthMortgage",
	toolpersonalloan: "toolPersonalLoan",
	personalloancalculator: "toolPersonalLoan",
	"personal-loan-calculator": "toolPersonalLoan",
	"personal-loan": "toolPersonalLoan",
	"simulador-credito-pessoal": "toolPersonalLoan",
	"credito-pessoal": "toolPersonalLoan",
	toolpropertytax: "toolPropertyTax",
	"imi-calculator": "toolPropertyTax",
	"imi-property-tax": "toolPropertyTax",
	imi: "toolPropertyTax",
	toolnetsalary: "toolNetSalary",
	"net-salary-calculator": "toolNetSalary",
	"net-salary": "toolNetSalary",
	"salario-liquido": "toolNetSalary",
	toolwithholdingtables: "toolWithholdingTables",
	"irs-withholding-tables": "toolWithholdingTables",
	"tabelas-de-irs": "toolWithholdingTables",
	"tabelas-irs": "toolWithholdingTables",
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

// Calculators with their own page outside /tools, which learn and glossary
// content can name as a related calculator too.
const CALCULATOR_PAGE_ROUTE_IDS = [
	"pageFireCalculator",
] as const satisfies ReadonlyArray<RouteId>

const LEGACY_CALCULATOR_PAGE_ROUTE_ID_BY_KEY: Record<string, RouteId> = {
	fire: "pageFireCalculator",
	"fire-calculator": "pageFireCalculator",
	"page-fire-calculator": "pageFireCalculator",
}

/**
 * Resolves a related calculator named in learn or glossary content: a tool
 * (resolveToolRouteIdFromLegacy) or a calculator page such as FIRE, by key or
 * by its slug in any language.
 */
export function resolveCalculatorRouteIdFromLegacy(
	value: string | null | undefined,
	lang: Lang,
): RouteId | undefined {
	const toolRouteId = resolveToolRouteIdFromLegacy(value, lang)

	if (toolRouteId || !value) {
		return toolRouteId
	}

	const normalized = normalizeRouteLookupKey(value)
	const directMatch = LEGACY_CALCULATOR_PAGE_ROUTE_ID_BY_KEY[normalized]

	if (directMatch) {
		return directMatch
	}

	return CALCULATOR_PAGE_ROUTE_IDS.find((routeId) =>
		SUPPORTED_LANGS.some(
			(slugLang) => normalizeRouteLookupKey(getLocalizedSlug(routeId, slugLang)) === normalized,
		),
	)
}

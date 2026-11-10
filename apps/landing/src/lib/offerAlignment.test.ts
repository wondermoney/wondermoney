import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const locales = ["en", "pt", "es", "fr", "de", "it"] as const
const root = fileURLToPath(new URL("../../", import.meta.url))

const read = (path: string) => readFileSync(`${root}/${path}`, "utf8")
const readJson = (path: string): Record<string, unknown> => JSON.parse(read(path))

const staleOfferPatterns = [
	/30[- ]day(?:s)?[^\n]*(?:free|trial)|(?:free|trial)[^\n]*30[- ]day(?:s)?/gi,
	/30 dias[^\n]*(?:grátis|gratuit|teste)|(?:grátis|gratuit|teste)[^\n]*30 dias/gi,
	/30 días[^\n]*(?:gratis|gratuit|prueba)|(?:gratis|gratuit|prueba)[^\n]*30 días/gi,
	/30 jours[^\n]*(?:gratuit|essai)|(?:gratuit|essai)[^\n]*30 jours/gi,
	/(?:30 Tage|30-täg)[^\n]*(?:kostenlos|Test)|(?:kostenlos|Test)[^\n]*(?:30 Tage|30-täg)/gi,
	/30 giorni[^\n]*(?:gratis|gratuit|prova)|(?:gratis|gratuit|prova)[^\n]*30 giorni/gi,
	/(?:1|one|(?:the\s+)?first)\s+month[^\n]{0,60}(?:free|at no cost)|free(?:\s+for)?[^\n]{0,30}(?:1|one|the first)\s+month/gi,
	/(?:1|um|(?:o\s+)?primeiro)\s+mês[^\n]{0,60}(?:grátis|gratuito)|(?:grátis|gratuito)[^\n]{0,30}(?:1|um|o primeiro)\s+mês/gi,
	/(?:1|un|(?:el\s+)?primer(?:o)?)\s+mes[^\n]{0,60}(?:gratis|gratuito)|(?:gratis|gratuito)[^\n]{0,30}(?:1|un|el primer(?:o)?)\s+mes/gi,
	/(?:1|un|(?:le\s+)?premier)\s+mois[^\n]{0,60}gratuit|gratuit[^\n]{0,30}(?:1|un|le premier)\s+mois/gi,
	/(?:1|ein(?:en)?|(?:der\s+)?erste[rsn]?)\s+Monat[^\n]{0,60}(?:kostenlos|gratis)|(?:kostenlos|gratis)[^\n]{0,30}(?:1|ein(?:en)?|der erste[rsn]?)\s+Monat/gi,
	/(?:1|un|(?:il\s+)?primo)\s+mese[^\n]{0,60}(?:gratis|gratuito)|(?:gratis|gratuito)[^\n]{0,30}(?:1|un|il primo)\s+mese/gi,
	/€(?:4[.,]99|39[.,]90)|(?:4,99|39,90)\s*(?:€|EUR)|EUR(?:4\.99|39\.90)/g,
	/€4[.,]15|4,15\s*€/g,
	/price:\s*["']?(?:4\.99|39\.90|4\.15)["']?/g,
]

const monthlyAnnualBillingPatterns = [
	/€3\.90\/month[\s\S]{0,160}(?:billed annually|annual billing)/gi,
	/€3,90\/mês[\s\S]{0,160}(?:faturad[oa] anualmente|faturação anual)/gi,
	/3,90\s*€\/mes[\s\S]{0,160}(?:facturad[oa] anualmente|facturación anual)/gi,
	/€3,90\/mois[\s\S]{0,160}(?:facturé[es]? annuellement|facturation annuelle)/gi,
	/€3,90\/Monat[\s\S]{0,160}(?:jährlich abgerechnet|Jahresabrechnung)/gi,
	/€3,90\/mese[\s\S]{0,160}(?:fatturat[oa] annualmente|fatturazione annuale)/gi,
]

// Retired prices plus the prices that were live before the free/open-source/BYOK
// pivot (€3.90/€24.90) — all now stale public claims on active offer surfaces.
const stalePricePattern =
	/€(?:4[.,]99|39[.,]90|4[.,]15|3[.,]90|24[.,]90)|(?:4,99|39,90|4,15|3,90|24,90)\s*(?:€|EUR)|EUR(?:4\.99|39\.90|3\.90|24\.90)|price:\s*["']?(?:4\.99|39\.90|4\.15|3\.90|24\.90)["']?/gi

const staleTrialLanguagePattern = /14[- ]day|no credit card/gi

const anyThirtyDayPattern = /30[- ]days?|30 dias|30 días|30 jours|30 Tage|30-täg|30 giorni/i
const acquisitionKeyPattern = /trial|offer|acquisition/i
const flattenStrings = (value: Record<string, unknown>, prefix = ""): Array<[string, string]> =>
	Object.entries(value).flatMap(([key, child]) => {
		const path = prefix ? `${prefix}.${key}` : key
		return typeof child === "string"
			? [[path, child]]
			: flattenStrings(child as Record<string, unknown>, path)
	})

// Verified via: grep -rl "lp.shared.trialNote" src --include="*.tsx"
const trialNoteConsumers = [
	"src/components/landing/BudgetApp.tsx",
	"src/components/landing/EtfTracker.tsx",
	"src/components/landing/FeatureAccounts.tsx",
	"src/components/landing/FeatureBudgeting.tsx",
	"src/components/landing/FeatureCategorization.tsx",
	"src/components/landing/FeatureCredits.tsx",
	"src/components/landing/FeatureFinancialMarkets.tsx",
	"src/components/landing/FeatureGoals.tsx",
	"src/components/landing/FeatureNetWorth.tsx",
	"src/components/landing/FeaturePortfolio.tsx",
	"src/components/landing/FeaturePrivacy.tsx",
	"src/components/landing/FeatureReports.tsx",
	"src/components/landing/FireCalculator.tsx",
	"src/components/landing/HowToCalculateNetWorth.tsx",
	"src/components/landing/NetWorthTracker.tsx",
	"src/components/landing/OpenBankingApp.tsx",
	"src/components/landing/PersonalFinanceApp.tsx",
	"src/components/landing/PortfolioTracker.tsx",
	"src/components/landing/sections/AdHero.tsx",
	"src/components/landing/YnabAlternative.tsx",
]

// €99 / Founding Member is banned everywhere.
const stalePriceNinetyNinePattern = /€99(?:[.,]00)?|99(?:[.,]00)?\s*(?:€|EUR)|EUR99(?:\.00)?|founding member/i

describe("public acquisition offer", () => {
	it("keeps source and public locale files identical", () => {
		for (const locale of locales) {
			expect(read(`public/locales/${locale}/common.json`)).toBe(
				read(`src/locales/${locale}/common.json`),
			)
		}
	})

	it("contains no stale trial or pricing claims in active offer surfaces", () => {
		const files = [
			...locales.flatMap((locale) => [
				`src/locales/${locale}/common.json`,
				`public/locales/${locale}/common.json`,
			]),
			"src/components/pages/HomePage.astro",
			"src/components/pages/TopLevelPage.astro",
			"src/components/pages/StandaloneLandingPage.astro",
		]

		const staleClaims = files.flatMap((file) =>
			[...staleOfferPatterns, ...monthlyAnnualBillingPatterns, stalePricePattern, staleTrialLanguagePattern].flatMap((pattern) =>
				[...read(file).matchAll(pattern)].map((match) => `${file}: ${match[0]}`),
			),
		)

		expect(staleClaims).toEqual([])

		for (const locale of locales) {
			for (const location of ["src", "public"]) {
				const file = `${location}/locales/${locale}/common.json`
				const acquisitionClaims = flattenStrings(readJson(file))
					.filter(([key, value]) => acquisitionKeyPattern.test(key) && anyThirtyDayPattern.test(value))
					.map(([key, value]) => `${file}:${key}: ${value}`)
				expect(acquisitionClaims).toEqual([])
			}
		}
	})

	it("keeps €99/Founding Member claims out of every surface", () => {
		for (const locale of locales) {
			for (const location of ["src", "public"]) {
				const file = `${location}/locales/${locale}/common.json`
				const staleClaims = flattenStrings(readJson(file))
					.filter(([, value]) => stalePriceNinetyNinePattern.test(value))
					.map(([key, value]) => `${file}:${key}: ${value}`)
				expect(staleClaims).toEqual([])
			}
		}
	})

	it("detects numeric and word-form free-month claims without rejecting unrelated 30-day copy", () => {
		const staleExamples = [
			"1 month free", "one month free", "the first month is completely free",
			"1 mês grátis", "um mês grátis", "o primeiro mês é completamente gratuito",
			"1 mes gratis", "un mes gratis", "el primer mes es completamente gratis",
			"1 mois gratuit", "un mois gratuit", "le premier mois est entièrement gratuit",
			"1 Monat kostenlos", "einen Monat kostenlos", "der erste Monat ist völlig kostenlos",
			"1 mese gratis", "un mese gratis", "il primo mese è completamente gratuito",
		]
		for (const example of staleExamples) {
			expect(staleOfferPatterns.some((pattern) => (pattern.lastIndex = 0, pattern.test(example)))).toBe(true)
		}
		expect(staleOfferPatterns.some((pattern) => (pattern.lastIndex = 0, pattern.test("Review transactions from the last 30 days")))).toBe(false)
		expect(anyThirtyDayPattern.test("30-day trial")).toBe(true)
	})

	it("rejects monthly prices presented as annual billing", () => {
		const staleExamples = [
			"€3.90/month, billed annually", "€3,90/mês, faturação anual",
			"3,90 €/mes, facturado anualmente", "€3,90/mois, facturé annuellement",
			"€3,90/Monat, jährlich abgerechnet", "€3,90/mese, fatturato annualmente",
		]
		for (const example of staleExamples) {
			expect(monthlyAnnualBillingPatterns.some((pattern) => pattern.test(example))).toBe(true)
		}
		expect(monthlyAnnualBillingPatterns.some((pattern) => pattern.test("€3.90/month or €24.90/year"))).toBe(false)
	})

	it("keeps all trial-note consumers on the shared, sign-ups-paused copy", () => {
		expect(trialNoteConsumers).toHaveLength(20)
		for (const file of trialNoteConsumers) {
			expect(read(file)).toMatch(/t\(["']lp\.shared\.trialNote["']\)/)
		}
	})

	it("no longer states a 14-day trial or no-credit-card offer in any locale", () => {
		for (const locale of locales) {
			const content = read(`src/locales/${locale}/common.json`)
			expect(content).not.toMatch(/14[- ]day/i)
			expect(content).not.toMatch(/no credit card/i)
			expect(content).not.toMatch(/€3\.90/)
			expect(content).not.toMatch(/€24\.90/)
		}
	})

	it("no longer publishes exact prices or a 14-day no-card trial in JSON-LD", () => {
		const home = read("src/components/pages/HomePage.astro")
		const pricing = read("src/components/pages/TopLevelPage.astro")

		expect(home).not.toMatch(/14-day full-access trial/i)
		expect(home).not.toMatch(/no credit card/i)
		expect(home).not.toMatch(/EUR3\.90\/month/)
		expect(home).not.toMatch(/EUR24\.90\/year/)
		expect(pricing).not.toMatch(/price: "3\.90"/)
		expect(pricing).not.toMatch(/price: "24\.90"/)
		expect(pricing).not.toMatch(/14-day full-access trial/i)
		expect(pricing).not.toMatch(/no credit card/i)
	})
})

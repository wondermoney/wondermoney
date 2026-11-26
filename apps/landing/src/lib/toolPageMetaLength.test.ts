import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { SUPPORTED_LANGS } from "./routes"

// A tool page's <title> is its `tools.<key>.pageTitle` as written (no brand suffix is added) and
// its meta description is `tools.<key>.pageDescription`. Search results cut a title after about
// 60 characters and a description after about 160, so both stay within those limits.
const MAX_TITLE = 60
const MAX_DESCRIPTION = 160

type Copy = { lp: Record<string, unknown>; tools: Record<string, unknown> }

// Landing pages under `lp.*` whose <title> is their `metaTitle` (brand suffix included, as written)
// and whose description is `metaDescription`: every `lp.*` key with a `metaTitle`, so a new page
// must be added here and fit the same limits.
const LP_PAGES = [
	"about",
	"accounts",
	"adFragmentation",
	"adNetWorth",
	"adOpenBanking",
	"alternativaExcel",
	"appFinancasPortugal",
	"budgetApp",
	"budgeting",
	"categorization",
	"controloGastos",
	"etfTracker",
	"featureAccounts",
	"featureAssistant",
	"featureBudgeting",
	"featureCategorization",
	"featureCredits",
	"featureFinancialMarkets",
	"featureGoals",
	"featureHousehold",
	"featureImports",
	"featureMultiCurrency",
	"featureNetWorth",
	"featurePortfolio",
	"featurePrivacy",
	"featureRecurring",
	"featureReports",
	"featureSelfHosting",
	"fireCalculator",
	"gestaoFinanceira",
	"howToCalculateNetWorth",
	"netWorthTracker",
	"openBankingApp",
	"personalFinanceApp",
	"portfolioTracker",
	"pricing",
	"privacy",
	"ynabAlternative",
] as const

// Every landing page title ends with the brand the same way.
const LP_TITLE_SUFFIX = " — WonderMoney"

function readLocale(base: "src/locales" | "public/locales", lang: string): Copy {
	return JSON.parse(readFileSync(fileURLToPath(new URL(`../../${base}/${lang}/common.json`, import.meta.url)), "utf8")) as Copy
}

function toolMeta(copy: Copy): Array<{ key: string; pageTitle: string; pageDescription: string }> {
	return Object.entries(copy.tools).flatMap(([key, value]) => {
		if (typeof value !== "object" || value === null) return []
		const { pageTitle, pageDescription } = value as Record<string, unknown>
		if (typeof pageTitle !== "string" || typeof pageDescription !== "string") return []
		return [{ key, pageTitle, pageDescription }]
	})
}

function lpMeta(copy: Copy): Array<{ key: string; pageTitle: string; pageDescription: string }> {
	return LP_PAGES.flatMap((key) => {
		const value = copy.lp[key]
		if (typeof value !== "object" || value === null) return []
		const { metaTitle, metaDescription } = value as Record<string, unknown>
		if (typeof metaTitle !== "string" || typeof metaDescription !== "string") return []
		return [{ key: `lp.${key}`, pageTitle: metaTitle, pageDescription: metaDescription }]
	})
}

const cases = SUPPORTED_LANGS.flatMap((lang) =>
	(["src/locales", "public/locales"] as const).map((base) => [`${base}/${lang}`, readLocale(base, lang)] as const),
)

describe("tool page titles and descriptions", () => {
	it("reads every tool page in every locale", () => {
		for (const [, copy] of cases) expect(toolMeta(copy).length).toBeGreaterThan(40)
	})

	it("reads every listed landing page in every locale", () => {
		for (const [, copy] of cases) {
			expect(lpMeta(copy).map(({ key }) => key)).toEqual(LP_PAGES.map((key) => `lp.${key}`))
			const withTitle = Object.entries(copy.lp)
				.filter(([, value]) => typeof value === "object" && value !== null && "metaTitle" in value)
				.map(([key]) => key)
			expect([...withTitle].sort()).toEqual([...LP_PAGES].sort())
		}
	})

	it.each(cases)(`%s ends every landing page title with "${LP_TITLE_SUFFIX}"`, (_name, copy) => {
		const unbranded = lpMeta(copy)
			.filter(({ pageTitle }) => !pageTitle.endsWith(LP_TITLE_SUFFIX))
			.map(({ key, pageTitle }) => `${key}: ${pageTitle}`)
		expect(unbranded).toEqual([])
	})

	it.each(cases)(`%s keeps every pageTitle within ${MAX_TITLE} characters`, (_name, copy) => {
		const tooLong = [...toolMeta(copy), ...lpMeta(copy)]
			.filter(({ pageTitle }) => pageTitle.length > MAX_TITLE)
			.map(({ key, pageTitle }) => `${key} (${pageTitle.length}): ${pageTitle}`)
		expect(tooLong).toEqual([])
	})

	it.each(cases)(`%s keeps every pageDescription within ${MAX_DESCRIPTION} characters`, (_name, copy) => {
		const tooLong = [...toolMeta(copy), ...lpMeta(copy)]
			.filter(({ pageDescription }) => pageDescription.length > MAX_DESCRIPTION)
			.map(({ key, pageDescription }) => `${key} (${pageDescription.length}): ${pageDescription}`)
		expect(tooLong).toEqual([])
	})
})

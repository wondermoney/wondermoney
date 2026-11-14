import { describe, expect, it } from "vitest"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, sep } from "node:path"
import { fileURLToPath } from "node:url"
import {
	STANDALONE_PAGE_ROUTE_IDS,
	SUPPORTED_LANGS,
	getLocalizedSlug,
	type Lang,
	resolveToolRouteIdFromLegacy,
	resolveFeatureRouteId,
	resolveToolRouteId,
	resolveTopLevelPageRouteId,
	toLocalizedPathname,
	toLang,
	toLocalizedPath,
	toToolsHubPath,
} from "./routes"

describe("route localization", () => {
	const requiredLpMetaKeys = [
		"lp.pricing.metaTitle",
		"lp.pricing.metaDescription",
		"lp.about.metaTitle",
		"lp.about.metaDescription",
		"lp.etfTracker.metaTitle",
		"lp.etfTracker.metaDescription",
		"lp.portfolioTracker.metaTitle",
		"lp.portfolioTracker.metaDescription",
		"lp.netWorthTracker.metaTitle",
		"lp.netWorthTracker.metaDescription",
		"lp.ynabAlternative.metaTitle",
		"lp.ynabAlternative.metaDescription",
		"lp.fireCalculator.metaTitle",
		"lp.fireCalculator.metaDescription",
		"lp.featureAccounts.metaTitle",
		"lp.featureAccounts.metaDescription",
		"lp.featureBudgeting.metaTitle",
		"lp.featureBudgeting.metaDescription",
		"lp.featureCategorization.metaTitle",
		"lp.featureCategorization.metaDescription",
		"lp.featurePrivacy.metaTitle",
		"lp.featurePrivacy.metaDescription",
		"lp.featurePortfolio.metaTitle",
		"lp.featurePortfolio.metaDescription",
		"lp.featureReports.metaTitle",
		"lp.featureReports.metaDescription",
	] as const

	function getByPath(value: unknown, path: string): unknown {
		return path
			.split(".")
			.reduce<unknown>((acc, segment) =>
				acc && typeof acc === "object"
					? (acc as Record<string, unknown>)[segment]
					: undefined,
			value,
			)
	}

	it("has short-locale dictionary files", () => {
		const baseDir = fileURLToPath(new URL("../../public/locales", import.meta.url))

		expect(existsSync(join(baseDir, "pt/common.json"))).toBe(true)
		expect(existsSync(join(baseDir, "en/common.json"))).toBe(true)
		expect(existsSync(join(baseDir, "es/common.json"))).toBe(true)
		expect(existsSync(join(baseDir, "fr/common.json"))).toBe(true)
		expect(existsSync(join(baseDir, "de/common.json"))).toBe(true)
		expect(existsSync(join(baseDir, "it/common.json"))).toBe(true)
	})

	it("supports all short languages", () => {
		expect(SUPPORTED_LANGS).toEqual(["pt", "en", "es", "fr", "de", "it"])
	})

	it("has required LP meta keys in all short-locale dictionaries", () => {
		const baseDir = fileURLToPath(new URL("../../public/locales", import.meta.url))

		for (const lang of SUPPORTED_LANGS) {
			const dictionaryPath = join(baseDir, lang, "common.json")
			const dictionary = JSON.parse(
				readFileSync(dictionaryPath, "utf8"),
			) as Record<string, unknown>

			for (const keyPath of requiredLpMetaKeys) {
				expect(getByPath(dictionary, keyPath)).not.toBeUndefined()
			}
		}
	})

	it("keeps QA-reviewed homepage claims aligned with current availability", () => {
		const baseDir = fileURLToPath(new URL("../../public/locales", import.meta.url))
		const pt = JSON.parse(
			readFileSync(join(baseDir, "pt", "common.json"), "utf8"),
		) as Record<string, unknown>
		const en = JSON.parse(
			readFileSync(join(baseDir, "en", "common.json"), "utf8"),
		) as Record<string, unknown>

		expect(
			getByPath(pt, "homepage.howItWorksSteps.step2.description"),
		).toContain("diari")
		expect(
			getByPath(pt, "homepage.howItWorksSteps.step2.description"),
		).not.toContain("tempo real")

		expect(getByPath(pt, "homepage.features.item5.status")).toBe("")
		expect(getByPath(en, "homepage.features.item5.status")).toBe("")
	})

	it("keeps Accounts/Privacy QA copy aligned across short locales", () => {
		const baseDir = fileURLToPath(new URL("../../public/locales", import.meta.url))
		const trueLayerParentheticalPattern = /\([^)]*TrueLayer[^)]*\)/i
		const unsupportedEncryptionAtRestPattern =
			/encrypted at rest|cifrado en reposo|encriptação em repouso|chiffrement au repos|verschlüsselt bei der speicherung|crittografato a riposo/i

		for (const lang of SUPPORTED_LANGS) {
			const dictionaryPath = join(baseDir, lang, "common.json")
			const dictionary = JSON.parse(
				readFileSync(dictionaryPath, "utf8"),
			) as Record<string, unknown>

			const accountsWhatBody = getByPath(
				dictionary,
				"lp.featureAccounts.whatBody",
			)
			const privacyOpenBankingBody = getByPath(
				dictionary,
				"lp.featurePrivacy.openBankingBody",
			)
			const principle4Body = getByPath(
				dictionary,
				"lp.featurePrivacy.principle4Body",
			)

			expect(accountsWhatBody).toEqual(expect.any(String))
			expect(privacyOpenBankingBody).toEqual(expect.any(String))
			expect(principle4Body).toEqual(expect.any(String))

			expect(accountsWhatBody as string).not.toMatch(
				trueLayerParentheticalPattern,
			)
			expect(privacyOpenBankingBody as string).not.toMatch(
				trueLayerParentheticalPattern,
			)

			expect(getByPath(dictionary, "lp.featurePrivacy.principle6Title")).toEqual(
				expect.any(String),
			)
			expect(getByPath(dictionary, "lp.featurePrivacy.principle6Body")).toEqual(
				expect.any(String),
			)

			expect(principle4Body as string).not.toMatch(unsupportedEncryptionAtRestPattern)
			expect(principle4Body as string).toMatch(/Open Banking|GoCardless|Enable Banking/i)
		}
	})

	it("keeps QA-targeted PT patrimônio wording scoped to specific LP sections", () => {
		const baseDir = fileURLToPath(new URL("../../public/locales", import.meta.url))
		const pt = JSON.parse(
			readFileSync(join(baseDir, "pt", "common.json"), "utf8"),
		) as Record<string, unknown>

		expect(getByPath(pt, "lp.netWorthTracker.how3Body")).toContain(
			"posição integrada",
		)
		expect(getByPath(pt, "lp.netWorthTracker.how3Body")).not.toContain(
			"património líquido real",
		)

		expect(getByPath(pt, "lp.etfTracker.feature5Title")).toBe(
			"Integração com património",
		)
		expect(getByPath(pt, "lp.etfTracker.feature5Body")).toContain(
			"cálculo total do teu património",
		)

		const etfTrackerSection = getByPath(pt, "lp.etfTracker")

		expect(etfTrackerSection).toEqual(expect.any(Object))

		expect(JSON.stringify(etfTrackerSection)).not.toContain("património líquido")
	})

	it("normalizes locale values", () => {
		expect(toLang("pt")).toBe("pt")
		expect(toLang("pt-PT")).toBe("pt")
		expect(toLang("fr")).toBe("fr")
		expect(toLang("en-US")).toBe("en")
	})

	it("localizes representative page, feature, and tool slugs", () => {
		expect(toLocalizedPath("pagePricing", "pt")).toBe("/pt/precos")
		expect(toLocalizedPath("pagePricing", "en")).toBe("/en/pricing")
		expect(toLocalizedPath("featureBudgeting", "pt")).toBe(
			"/pt/features/orcamentos",
		)
		expect(toLocalizedPath("featureBudgeting", "en")).toBe(
			"/en/features/budgeting",
		)
		expect(toLocalizedPath("toolNetWorth", "pt")).toBe(
			"/pt/tools/patrimonio-liquido",
		)
		expect(toLocalizedPath("toolNetWorth", "en")).toBe(
			"/en/tools/net-worth-calculator",
		)
	})

	it("resolves localized slugs back to route ids", () => {
		expect(resolveTopLevelPageRouteId("en", "about")).toBe("pageAbout")
		expect(resolveFeatureRouteId("pt", "orcamentos")).toBe(
			"featureBudgeting",
		)
		expect(resolveFeatureRouteId("en", "privacy")).toBe("featurePrivacy")
		expect(resolveToolRouteId("pt", "juros-compostos")).toBe(
			"toolCompoundInterest",
		)
		expect(resolveToolRouteId("en", "investment-return-calculator")).toBe(
			"toolInvestmentReturn",
		)
	})

	it("resolves legacy calculator identifiers to tool route ids", () => {
		expect(resolveToolRouteIdFromLegacy("toolCompoundInterest", "pt")).toBe(
			"toolCompoundInterest",
		)
		expect(resolveToolRouteIdFromLegacy("compound-interest-calculator", "pt")).toBe(
			"toolCompoundInterest",
		)
		expect(resolveToolRouteIdFromLegacy("juros-compostos", "pt")).toBe(
			"toolCompoundInterest",
		)
		expect(resolveToolRouteIdFromLegacy("netWorthCalculator", "en")).toBe(
			"toolNetWorth",
		)
		expect(resolveToolRouteIdFromLegacy("investment_return_calculator", "en")).toBe(
			"toolInvestmentReturn",
		)
		expect(resolveToolRouteIdFromLegacy("toolMortgage", "en")).toBeUndefined()
		expect(resolveToolRouteIdFromLegacy("mortgage-calculator", "en")).toBeUndefined()
		expect(
			resolveToolRouteIdFromLegacy("how-to-calculate-net-worth", "en"),
		).toBeUndefined()
		expect(resolveToolRouteIdFromLegacy("unknown-calculator", "en")).toBeUndefined()
	})

	it("throws when localized slug is unknown", () => {
		expect(() => resolveTopLevelPageRouteId("pt", "desconhecida")).toThrow()
		expect(() => resolveFeatureRouteId("pt", "nao-existe")).toThrow()
		expect(() => resolveToolRouteId("pt", "nao-existe")).toThrow()
	})

	it("does not expose removed routes", () => {
		expect(() => toLocalizedPath("toolMortgage" as never, "pt")).toThrow()
		expect(() =>
			toLocalizedPath("howToCalculateNetWorth" as never, "pt"),
		).toThrow()
		expect(() => resolveToolRouteId("en", "mortgage-calculator")).toThrow()
		expect(() => resolveToolRouteId("en", "how-to-calculate-net-worth")).toThrow()
	})

	it("does not surface removed mortgage/how-to links in tools hub mappings", () => {
		const toolsHubPath = fileURLToPath(
			new URL("../pages/en/tools/index.astro", import.meta.url),
		)
		const toolPagePath = fileURLToPath(
			new URL("../pages/en/tools/[tool].astro", import.meta.url),
		)

		const toolsHubSource = readFileSync(toolsHubPath, "utf8")
		const toolPageSource = readFileSync(toolPagePath, "utf8")

		expect(toolsHubSource).not.toContain("toolMortgage")
		expect(toolsHubSource).not.toContain("mortgage-calculator")
		expect(toolsHubSource).not.toContain("how-to-calculate-net-worth")

		expect(toolPageSource).not.toContain("toolMortgage")
		expect(toolPageSource).not.toContain("mortgage-calculator")
		expect(toolPageSource).not.toContain("how-to-calculate-net-worth")
	})

	it("does not include learn/glossary in header/footer navigation source", () => {
		const headerPath = fileURLToPath(
			new URL("../components/shared/Header.tsx", import.meta.url),
		)
		const footerPath = fileURLToPath(
			new URL("../components/shared/Footer.tsx", import.meta.url),
		)

		const headerSource = readFileSync(headerPath, "utf8")
		const footerSource = readFileSync(footerPath, "utf8")

		expect(headerSource).not.toContain('href: "/learn"')
		expect(headerSource).not.toContain('href: "/glossary"')
		expect(footerSource).not.toContain('href: "/learn"')
		expect(footerSource).not.toContain('href: "/glossary"')
	})

	it("builds nav route paths via helper", () => {
		expect(toLocalizedPath("pagePricing", "pt")).toBe("/pt/precos")
		expect(toLocalizedPath("pageAbout", "en")).toBe("/en/about")
		expect(toToolsHubPath("pt")).toBe("/pt/tools")
		expect(toLocalizedPath("featureAccounts", "fr")).toBe(
			"/fr/features/comptes",
		)
	})

	it("maps localized route slugs when switching language", () => {
		// pagePricing left TOP_LEVEL_PAGE_ROUTE_IDS (the page is gone, redirected
		// at the edge — see vercel.json), so "preise" is now an unresolved slug
		// and falls through to the same passthrough behavior as any other
		// unknown top-level slug.
		expect(toLocalizedPathname("/de/preise", "es")).toBe("/es/preise")
		expect(toLocalizedPathname("/de/features/konten", "es")).toBe(
			"/es/features/cuentas",
		)
		expect(toLocalizedPathname("/de/tools/zinseszins-rechner", "es")).toBe(
			"/es/tools/interes-compuesto",
		)
		expect(toLocalizedPathname("/en", "fr")).toBe("/fr")
		expect(toLocalizedPathname("/de/unknown-slug", "es")).toBe(
			"/es/unknown-slug",
		)
	})
})

describe("standalone page routes", () => {
	const pagesDir = fileURLToPath(new URL("../pages", import.meta.url))
	const vercelConfig = JSON.parse(
		readFileSync(fileURLToPath(new URL("../../vercel.json", import.meta.url)), "utf8"),
	) as {
		redirects: Array<{
			source: string
			destination: string
			statusCode: number
			has?: Array<{ type: string; value: string }>
		}>
	}

	function routeFilesFor(lang: Lang): string[] {
		return readdirSync(join(pagesDir, lang), { recursive: true, encoding: "utf8" })
			.filter((file) => file.endsWith(".astro"))
			.map((file) => file.split(sep).join("/"))
	}

	function standalonePageIdIn(lang: Lang, file: string): string | undefined {
		const source = readFileSync(join(pagesDir, lang, file), "utf8")
		return source.match(/<StandaloneLandingPage[^>]*\bpageId="([^"]+)"/)?.[1]
	}

	it.each(SUPPORTED_LANGS)(
		"renders each standalone page once in %s, under its localized slug",
		(lang) => {
			const filesByPageId = new Map<string, string[]>()
			for (const file of routeFilesFor(lang)) {
				const pageId = standalonePageIdIn(lang, file)
				if (pageId) {
					filesByPageId.set(pageId, [...(filesByPageId.get(pageId) ?? []), file])
				}
			}

			expect([...filesByPageId.keys()].sort()).toEqual(
				[...STANDALONE_PAGE_ROUTE_IDS].sort(),
			)
			for (const routeId of STANDALONE_PAGE_ROUTE_IDS) {
				expect(filesByPageId.get(routeId)).toEqual([
					`${getLocalizedSlug(routeId, lang)}.astro`,
				])
			}
		},
	)

	it("301s the Portuguese-slug addresses in other locales to the localized slug", () => {
		const expected = SUPPORTED_LANGS.filter((lang) => lang !== "pt").flatMap((lang) =>
			STANDALONE_PAGE_ROUTE_IDS.filter(
				(routeId) => getLocalizedSlug(routeId, "pt") !== getLocalizedSlug(routeId, lang),
			).map((routeId) => ({
				source: `/${lang}/${getLocalizedSlug(routeId, "pt")}`,
				destination: toLocalizedPath(routeId, lang),
			})),
		)

		expect(expected).toHaveLength(18)
		for (const { source, destination } of expected) {
			expect(vercelConfig.redirects).toContainEqual({
				source,
				has: [{ type: "host", value: "wonder.money" }],
				destination,
				statusCode: 301,
			})
		}
	})

	it("never redirects away from an address that has its own route file", () => {
		for (const { source } of vercelConfig.redirects) {
			const [lang, ...rest] = source.split("/").filter(Boolean)
			if (!SUPPORTED_LANGS.includes(lang as Lang) || source.includes(":")) continue
			expect(existsSync(join(pagesDir, lang, `${rest.join("/")}.astro`))).toBe(false)
			expect(existsSync(join(pagesDir, lang, ...rest, "index.astro"))).toBe(false)
		}
	})

	it("maps standalone page slugs when switching language", () => {
		expect(toLocalizedPathname("/pt/controlo-gastos", "en")).toBe("/en/expense-tracker")
		expect(toLocalizedPathname("/en/expense-tracker", "pt")).toBe("/pt/controlo-gastos")
		expect(toLocalizedPathname("/de/finanzverwaltung", "it")).toBe(
			"/it/gestione-finanziaria",
		)
		expect(toLocalizedPathname("/es/alternativa-excel", "fr")).toBe(
			"/fr/alternative-excel",
		)
		expect(toLocalizedPathname("/fr/app-finances-personnelles", "en")).toBe(
			"/en/personal-finance-app-portugal",
		)
	})
})

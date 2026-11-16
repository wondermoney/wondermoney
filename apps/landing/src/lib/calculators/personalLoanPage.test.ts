import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { getToolStaticPaths } from "../pageStaticPaths"
import {
	SUPPORTED_LANGS,
	resolveToolRouteId,
	resolveToolRouteIdFromLegacy,
	toLocalizedPath,
	toLocalizedPathname,
	type Lang,
} from "../routes"
import { buildToolsHub } from "../toolsCatalog"

// pageStaticPaths imports the Sanity client for the content routes; tool paths never call it.
vi.mock("sanity:client", () => ({ sanityClient: { fetch: vi.fn() } }))

function readSource(relativePath: string): string {
	return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
}

function readLocale(base: "src/locales" | "public/locales", lang: string) {
	return JSON.parse(readSource(`../../../${base}/${lang}/common.json`)) as {
		tools: Record<string, Record<string, unknown>>
	}
}

function keyPaths(value: unknown, prefix = ""): string[] {
	if (typeof value !== "object" || value === null) return [prefix]
	return Object.entries(value).flatMap(([key, child]) =>
		keyPaths(child, prefix ? `${prefix}.${key}` : key),
	)
}

function textAt(copy: unknown, path: string): string {
	return path
		.split(".")
		.reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], copy) as string
}

const copyFor = (lang: Lang) => readLocale("src/locales", lang).tools.personalLoan

const expectedPaths: Record<Lang, string> = {
	pt: "/pt/tools/simulador-credito-pessoal",
	en: "/en/tools/personal-loan-calculator",
	es: "/es/tools/simulador-prestamo-personal",
	fr: "/fr/tools/simulateur-pret-personnel",
	de: "/de/tools/privatkredit-rechner",
	it: "/it/tools/calcolo-prestito-personale",
}

const guide = () => readSource("../../components/calculators/PersonalLoanGuide.astro")
const component = () => readSource("../../components/calculators/PersonalLoanCalculatorComp.tsx")

describe("personal loan tool page", () => {
	it.each(SUPPORTED_LANGS)("has a localized tool path in %s that resolves back", (lang) => {
		expect(toLocalizedPath("toolPersonalLoan", lang)).toBe(expectedPaths[lang])
		const slug = expectedPaths[lang].split("/").pop() as string
		expect(resolveToolRouteId(lang, slug)).toBe("toolPersonalLoan")
	})

	it("is prerendered once per locale, with no legacy redirect page", () => {
		for (const lang of SUPPORTED_LANGS) {
			const pages = getToolStaticPaths(lang).filter((path) => path.props.routeId === "toolPersonalLoan")
			expect(pages).toHaveLength(1)
			expect(pages[0].props.redirectTo).toBeUndefined()
			expect(pages[0].params.tool).toBe(expectedPaths[lang].split("/").pop())
		}
	})

	it("keeps the slug when switching language", () => {
		expect(toLocalizedPathname("/pt/tools/simulador-credito-pessoal", "es")).toBe(
			"/es/tools/simulador-prestamo-personal",
		)
		expect(toLocalizedPathname("/it/tools/calcolo-prestito-personale", "de")).toBe(
			"/de/tools/privatkredit-rechner",
		)
	})

	it("can be linked from learn and glossary content", () => {
		for (const value of [
			"toolPersonalLoan",
			"personalLoanCalculator",
			"personal-loan",
			"personal-loan-calculator",
			"simulador-credito-pessoal",
			"credito-pessoal",
		]) {
			expect(resolveToolRouteIdFromLegacy(value, "en")).toBe("toolPersonalLoan")
		}
		expect(resolveToolRouteIdFromLegacy("privatkredit-rechner", "de")).toBe("toolPersonalLoan")
		// The mortgage calculator stays a different tool.
		expect(resolveToolRouteIdFromLegacy("credito-habitacao", "pt")).toBe("toolMortgage")
	})

	it.each(SUPPORTED_LANGS)("is listed on the %s tools hub, last in the borrowing tools", (lang) => {
		const group = buildToolsHub(lang).find((candidate) => candidate.id === "borrowAndBuyHome")

		expect(group?.tools.at(-1)).toMatchObject({
			key: "personalLoan",
			routeId: "toolPersonalLoan",
			href: expectedPaths[lang],
		})
	})

	it("closes with its own next step into the app", () => {
		const page = readSource("../../components/pages/ToolDetailPage.astro")

		expect(page).toContain('headline: t("tools.personalLoan.nextStepHeadline")')
		expect(page).toContain('routeId === "toolPersonalLoan" && <PersonalLoanCalculatorComp')
		expect(page).toContain('routeId === "toolPersonalLoan" && <PersonalLoanGuide')
		expect(copyFor("en").nextStepHeadline).toBe("Track this loan alongside your budget")
	})

	it("links the guide to the debt-to-income and household budget tools", () => {
		expect(guide()).toContain('routeId: "toolDebtToIncome"')
		expect(guide()).toContain('routeId: "toolHouseholdBudget"')
	})

	it("works the example with the calculator's own function and adds no FAQ structured data", () => {
		expect(guide()).toContain("computePersonalLoan(")
		expect(guide()).not.toMatch(/FAQPage|application\/ld\+json/)
	})

	it("runs on the shared fixed-rate loan engine", () => {
		const calculation = readSource("./personalLoan.ts")

		expect(calculation).toContain('from "./amortization"')
		expect(calculation).toContain("amortizeLevelPayment(")
	})

	it("reports use as tool_used with no amounts", () => {
		expect(component()).toContain(
			'pushGtmEvent({ event: "tool_used", tool: "personal_loan", page_type: getPageType() })',
		)
	})

	it("has the same copy keys in every locale and in the public mirror", () => {
		const reference = keyPaths(copyFor("en")).sort()

		for (const lang of SUPPORTED_LANGS) {
			const copy = copyFor(lang)
			expect(keyPaths(copy).sort()).toEqual(reference)
			for (const path of reference) expect(textAt(copy, path), `${lang} ${path}`).toMatch(/\S/)
			expect(readLocale("public/locales", lang).tools.personalLoan).toEqual(copy)
		}
	})

	it("uses the same placeholders in every locale", () => {
		const placeholders = (lang: Lang) => {
			const copy = copyFor(lang)
			return Object.fromEntries(
				keyPaths(copy).map((path) => [
					path,
					[...textAt(copy, path).matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort(),
				]),
			)
		}
		const reference = placeholders("en")

		for (const lang of SUPPORTED_LANGS) expect(placeholders(lang)).toEqual(reference)
	})

	it("takes the limits from the calculation, not the copy", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = copyFor(lang)
			expect(textAt(copy, "termMonthsHelp")).toMatch(/\{\{min\}\}.*\{\{max\}\}/)
			expect(textAt(copy, "guide.assumptionLimits")).toContain("{{maxAmount}}")
			for (const path of ["termMonthsHelp", "errors.termMonths.tooSmall", "errors.termMonths.tooLarge"]) {
				expect(textAt(copy, path)).not.toMatch(/\b(6|120)\b/)
			}
		}
	})

	it("says in every locale that the APR is an estimate and that lenders follow their country's rules", () => {
		const en = copyFor("en")
		expect(textAt(en, "result.aprNote")).toMatch(/estimate/)
		expect(textAt(en, "result.aprNote")).toMatch(/country's rules/)
		expect(textAt(en, "estimateNote")).toMatch(/not a loan offer or a quote/)
		for (const lang of SUPPORTED_LANGS) {
			const copy = copyFor(lang)
			expect(textAt(copy, "estimateNote").length).toBeGreaterThan(80)
			expect(textAt(copy, "result.aprNote").length).toBeGreaterThan(80)
			expect(textAt(copy, "guide.aprBody3").length).toBeGreaterThan(80)
		}
		expect(textAt(copyFor("pt"), "result.apr")).toContain("TAEG")
		expect(textAt(copyFor("es"), "result.apr")).toContain("TAE")
		expect(textAt(copyFor("fr"), "result.apr")).toContain("TAEG")
		expect(textAt(copyFor("it"), "result.apr")).toContain("TAEG")
	})

	it("has a unique title and meta description per locale", () => {
		const copies = SUPPORTED_LANGS.map(copyFor)

		expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("addresses the pt reader as tu", () => {
		const pt = JSON.stringify(copyFor("pt"))

		expect(pt).not.toMatch(/\bvocê\b|\bseu\b|\bsua\b|\bseus\b|\bsuas\b/iu)
	})
})

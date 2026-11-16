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

const copyFor = (lang: Lang) => readLocale("src/locales", lang).tools.rateRevision

const expectedPaths: Record<Lang, string> = {
	pt: "/pt/tools/simulador-revisao-taxa-credito",
	en: "/en/tools/variable-rate-payment-calculator",
	es: "/es/tools/simulador-revision-tipo-interes",
	fr: "/fr/tools/simulateur-revision-taux-variable",
	de: "/de/tools/zinsanpassung-rechner",
	it: "/it/tools/simulatore-rata-mutuo-variabile",
}

const guideSource = () => readSource("../../components/calculators/RateRevisionGuide.astro")
const componentSource = () => readSource("../../components/calculators/RateRevisionCalculatorComp.tsx")

describe("rate revision tool page", () => {
	it.each(SUPPORTED_LANGS)("has a localized tool path in %s that resolves back", (lang) => {
		expect(toLocalizedPath("toolRateRevision", lang)).toBe(expectedPaths[lang])
		const slug = expectedPaths[lang].split("/").pop() as string
		expect(resolveToolRouteId(lang, slug)).toBe("toolRateRevision")
	})

	it("is prerendered once per locale, with no legacy redirect page", () => {
		for (const lang of SUPPORTED_LANGS) {
			const pages = getToolStaticPaths(lang).filter((path) => path.props.routeId === "toolRateRevision")
			expect(pages).toHaveLength(1)
			expect(pages[0].props.redirectTo).toBeUndefined()
			expect(pages[0].params.tool).toBe(expectedPaths[lang].split("/").pop())
		}
	})

	it("keeps the slug when switching language", () => {
		expect(toLocalizedPathname("/pt/tools/simulador-revisao-taxa-credito", "es")).toBe(
			"/es/tools/simulador-revision-tipo-interes",
		)
		expect(toLocalizedPathname("/de/tools/zinsanpassung-rechner", "en")).toBe(
			"/en/tools/variable-rate-payment-calculator",
		)
	})

	it("names the tool for variable rates in general, not one index, in its slugs", () => {
		for (const path of Object.values(expectedPaths)) expect(path).not.toMatch(/euribor/i)
	})

	it("can be linked from learn and glossary content", () => {
		for (const value of [
			"toolRateRevision",
			"rateRevisionCalculator",
			"rate-revision",
			"variable-rate-payment-calculator",
			"simulador-revisao-taxa-credito",
		]) {
			expect(resolveToolRouteIdFromLegacy(value, "en")).toBe("toolRateRevision")
		}
		expect(resolveToolRouteIdFromLegacy("zinsanpassung-rechner", "de")).toBe("toolRateRevision")
		// The mortgage calculator stays a different tool.
		expect(resolveToolRouteIdFromLegacy("credito-habitacao", "pt")).toBe("toolMortgage")
	})

	it.each(SUPPORTED_LANGS)("is listed last among the %s home-buying tools on the hub", (lang) => {
		const group = buildToolsHub(lang).find((candidate) => candidate.id === "borrowAndBuyHome")

		expect(group?.tools.at(-1)).toMatchObject({
			key: "rateRevision",
			routeId: "toolRateRevision",
			href: expectedPaths[lang],
		})
	})

	it("has a short name for the tools menu in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			expect(copyFor(lang).shortName).toEqual(expect.stringMatching(/\S/))
			expect((copyFor(lang).shortName as string).length).toBeLessThan(25)
		}
	})

	it("closes with its own next step into the app", () => {
		const page = readSource("../../components/pages/ToolDetailPage.astro")

		expect(page).toContain('headline: t("tools.rateRevision.nextStepHeadline")')
		expect(copyFor("en").nextStepHeadline).toBe("Plan for a higher payment in your budget")
	})

	it("links the guide to the mortgage, debt-to-income and early repayment tools", () => {
		const guide = guideSource()

		expect(guide).toContain('routeId: "toolMortgage"')
		expect(guide).toContain('routeId: "toolDebtToIncome"')
		expect(guide).toContain('routeId: "toolEarlyRepayment"')
	})

	it("works the example with the calculator's own function and adds no FAQ structured data", () => {
		const guide = guideSource()

		expect(guide).toContain("computeRateRevision(")
		expect(guide).not.toMatch(/FAQPage|application\/ld\+json/)
	})

	it("uses the shared loan engine and the debt-to-income bands", () => {
		const calculation = readSource("./rateRevision.ts")

		expect(calculation).toContain('from "./amortization"')
		expect(calculation).toContain("amortizeLevelPayment(")
		expect(calculation).toContain("computeDebtToIncome(")
		expect(componentSource()).toContain('"tools.debtToIncome.bandCaution"')
	})

	it("reports use as tool_used with no amounts", () => {
		expect(componentSource()).toContain(
			'pushGtmEvent({ event: "tool_used", tool: "rate_revision", page_type: getPageType() })',
		)
	})

	it("has the same copy keys in every locale and in the public mirror", () => {
		const reference = keyPaths(copyFor("en")).sort()

		for (const lang of SUPPORTED_LANGS) {
			const copy = copyFor(lang)
			expect(keyPaths(copy).sort()).toEqual(reference)
			expect(readLocale("public/locales", lang).tools.rateRevision).toEqual(copy)
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
			expect(textAt(copy, "guide.limits")).toMatch(/\{\{minIndex\}\}.*\{\{maxIndex\}\}.*\{\{maxSpread\}\}/)
			for (const field of ["indexRate", "newIndexRate"]) {
				expect(textAt(copy, `errors.${field}.tooSmall`)).toContain("{{min}}")
				expect(textAt(copy, `errors.${field}.tooLarge`)).toContain("{{max}}")
			}
		}
	})

	it("says in every locale that the rate applies from next month and that contracts decide the rest", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = copyFor(lang)
			expect(textAt(copy, "assumptionNote").length).toBeGreaterThan(80)
			for (const path of [
				"guide.assumptions.fromNextMonth",
				"guide.assumptions.noFeed",
				"guide.contractItems.resetDates",
				"guide.contractItems.capsFloors",
			]) {
				expect(textAt(copy, path).length).toBeGreaterThan(60)
			}
		}
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

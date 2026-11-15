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

const copyFor = (lang: Lang) => readLocale("src/locales", lang).tools.borrowingCapacity

const expectedPaths: Record<Lang, string> = {
	pt: "/pt/tools/quanto-posso-pedir-emprestado",
	en: "/en/tools/how-much-can-i-borrow",
	es: "/es/tools/cuanto-puedo-pedir-prestado",
	fr: "/fr/tools/combien-puis-je-emprunter",
	de: "/de/tools/wie-viel-kredit-bekomme-ich",
	it: "/it/tools/quanto-mutuo-posso-chiedere",
}

describe("borrowing capacity tool page", () => {
	it.each(SUPPORTED_LANGS)("has a localized tool path in %s that resolves back", (lang) => {
		expect(toLocalizedPath("toolBorrowingCapacity", lang)).toBe(expectedPaths[lang])
		const slug = expectedPaths[lang].split("/").pop() as string
		expect(resolveToolRouteId(lang, slug)).toBe("toolBorrowingCapacity")
	})

	it("is prerendered once per locale, with no legacy redirect page", () => {
		for (const lang of SUPPORTED_LANGS) {
			const pages = getToolStaticPaths(lang).filter(
				(path) => path.props.routeId === "toolBorrowingCapacity",
			)
			expect(pages).toHaveLength(1)
			expect(pages[0].props.redirectTo).toBeUndefined()
			expect(pages[0].params.tool).toBe(expectedPaths[lang].split("/").pop())
		}
	})

	it("keeps the slug when switching language", () => {
		expect(toLocalizedPathname("/pt/tools/quanto-posso-pedir-emprestado", "fr")).toBe(
			"/fr/tools/combien-puis-je-emprunter",
		)
		expect(toLocalizedPathname("/de/tools/wie-viel-kredit-bekomme-ich", "en")).toBe(
			"/en/tools/how-much-can-i-borrow",
		)
	})

	it("can be linked from learn and glossary content", () => {
		for (const value of [
			"toolBorrowingCapacity",
			"borrowingCapacityCalculator",
			"borrowing-capacity",
			"how-much-can-i-borrow",
			"quanto-posso-pedir-emprestado",
		]) {
			expect(resolveToolRouteIdFromLegacy(value, "en")).toBe("toolBorrowingCapacity")
		}
		expect(resolveToolRouteIdFromLegacy("cuanto-puedo-pedir-prestado", "es")).toBe(
			"toolBorrowingCapacity",
		)
		// The mortgage calculator stays a different tool.
		expect(resolveToolRouteIdFromLegacy("credito-habitacao", "pt")).toBe("toolMortgage")
	})

	it.each(SUPPORTED_LANGS)("is listed on the %s tools hub, with the home-buying tools", (lang) => {
		const group = buildToolsHub(lang).find((candidate) =>
			candidate.tools.some((tool) => tool.routeId === "toolBorrowingCapacity"),
		)

		expect(group?.id).toBe("borrowAndBuyHome")
		expect(group?.tools.find((tool) => tool.routeId === "toolBorrowingCapacity")).toMatchObject({
			key: "borrowingCapacity",
			href: expectedPaths[lang],
		})
	})

	it("closes with its own next step into the app", () => {
		const page = readSource("../../components/pages/ToolDetailPage.astro")

		expect(page).toContain('headline: t("tools.borrowingCapacity.nextStepHeadline")')
		expect(copyFor("en").nextStepHeadline).toBe("Plan your deposit and monthly housing costs")
	})

	it("links the guide to the mortgage and debt-to-income tools", () => {
		const guide = readSource("../../components/calculators/BorrowingCapacityGuide.astro")

		expect(guide).toContain('routeId: "toolMortgage"')
		expect(guide).toContain('routeId: "toolDebtToIncome"')
	})

	it("works the example with the calculator's own function and adds no FAQ structured data", () => {
		const guide = readSource("../../components/calculators/BorrowingCapacityGuide.astro")

		expect(guide).toContain("computeBorrowingCapacity(")
		expect(guide).not.toMatch(/FAQPage|application\/ld\+json/)
	})

	it("takes its payments from the mortgage calculator and its bands from the debt-to-income tool", () => {
		const calculation = readSource("./borrowingCapacity.ts")
		const component = readSource("../../components/calculators/BorrowingCapacityCalculatorComp.tsx")

		expect(calculation).toContain('from "./mortgage"')
		expect(calculation).toContain("computeMortgage(")
		expect(calculation).toContain("computeDebtToIncome(")
		expect(component).toContain("classifyDebtToIncome(")
		expect(component).toContain('"tools.debtToIncome.bandCaution"')
	})

	it("reports use as tool_used with no amounts", () => {
		const component = readSource("../../components/calculators/BorrowingCapacityCalculatorComp.tsx")

		expect(component).toContain(
			'pushGtmEvent({ event: "tool_used", tool: "borrowing_capacity", page_type: getPageType() })',
		)
	})

	it("has the same copy keys in every locale and in the public mirror", () => {
		const reference = keyPaths(copyFor("en")).sort()

		for (const lang of SUPPORTED_LANGS) {
			const copy = copyFor(lang)
			expect(keyPaths(copy).sort()).toEqual(reference)
			expect(readLocale("public/locales", lang).tools.borrowingCapacity).toEqual(copy)
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

	it("takes the defaults and limits from the calculation, not the copy", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = copyFor(lang)
			expect(textAt(copy, "maxDebtShareHelp")).toMatch(/\{\{min\}\}.*\{\{max\}\}/)
			expect(textAt(copy, "purchaseCostsRateHelp")).toContain("{{rate}}")
			expect(textAt(copy, "maxLoanToValueHelp")).toContain("{{rate}}")
			expect(textAt(copy, "status.outOfRange")).toContain("{{max}}")
			for (const path of ["maxDebtShareHelp", "purchaseCostsRateHelp", "maxLoanToValueHelp"]) {
				expect(textAt(copy, path)).not.toMatch(/\b(7|10|35|60|90)\s?%/)
			}
		}
	})

	it("says in every locale that lenders apply their own rules and that this is an estimate", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = copyFor(lang)
			expect(textAt(copy, "lenderNote").length).toBeGreaterThan(80)
			for (const path of ["guide.lenderStress", "guide.lenderIncome", "guide.lenderCountry"]) {
				expect(textAt(copy, path).length).toBeGreaterThan(40)
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

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
} from "../routes"
import { buildToolsHub } from "../toolsCatalog"
import {
	BUY_VS_RENT_EXAMPLE,
	BUY_VS_RENT_EXAMPLE_ALTERNATIVE_RENT,
	computeBuyVsRent,
	type BuyVsRentField,
	type BuyVsRentInputError,
} from "./buyVsRent"

// pageStaticPaths imports the Sanity client for the content routes; tool paths never call it.
vi.mock("sanity:client", () => ({ sanityClient: { fetch: vi.fn() } }))

type ToolCopy = Record<string, unknown> & {
	pageTitle: string
	pageDescription: string
	ctaHeadline: string
	fields: Record<string, { label: string; help?: string }>
	errors: Record<string, string>
}

function readLocale(base: "src/locales" | "public/locales", lang: string) {
	const path = fileURLToPath(new URL(`../../../${base}/${lang}/common.json`, import.meta.url))
	return JSON.parse(readFileSync(path, "utf8")) as { tools: Record<string, ToolCopy> }
}

function readSource(relativePath: string) {
	return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
}

function keyPaths(value: unknown, prefix = ""): string[] {
	if (typeof value !== "object" || value === null) return [prefix]
	return Object.entries(value).flatMap(([key, child]) =>
		keyPaths(child, prefix ? `${prefix}.${key}` : key),
	)
}

const FIELDS = Object.keys(BUY_VS_RENT_EXAMPLE) as BuyVsRentField[]
const ERRORS: BuyVsRentInputError[] = [
	"required",
	"tooSmall",
	"tooLarge",
	"negative",
	"aboveHomePrice",
	"loanTooSmall",
]

describe("buy versus rent tool page", () => {
	it("has a localized tool route in every locale", () => {
		expect(SUPPORTED_LANGS.map((lang) => toLocalizedPath("toolBuyVsRent", lang))).toEqual([
			"/pt/tools/comprar-ou-arrendar-casa",
			"/en/tools/rent-vs-buy-calculator",
			"/es/tools/comprar-o-alquilar-vivienda",
			"/fr/tools/acheter-ou-louer",
			"/de/tools/kaufen-oder-mieten-rechner",
			"/it/tools/comprare-o-affittare-casa",
		])
		for (const lang of SUPPORTED_LANGS) {
			const slug = toLocalizedPath("toolBuyVsRent", lang).split("/").pop() as string
			expect(resolveToolRouteId(lang, slug)).toBe("toolBuyVsRent")
		}
	})

	it("is prerendered from the tool static paths with no legacy redirect page", () => {
		for (const lang of SUPPORTED_LANGS) {
			const pages = getToolStaticPaths(lang).filter((path) => path.props.routeId === "toolBuyVsRent")
			expect(pages).toHaveLength(1)
			expect(pages[0].params.tool).toBe(toLocalizedPath("toolBuyVsRent", lang).split("/").pop())
		}
	})

	it("keeps the slug when switching language", () => {
		expect(toLocalizedPathname("/pt/tools/comprar-ou-arrendar-casa", "en")).toBe(
			"/en/tools/rent-vs-buy-calculator",
		)
	})

	it("can be linked from learn and glossary content", () => {
		expect(resolveToolRouteIdFromLegacy("comprar-ou-arrendar-casa", "en")).toBe("toolBuyVsRent")
		expect(resolveToolRouteIdFromLegacy("buyVsRent", "pt")).toBe("toolBuyVsRent")
	})

	it("is listed on the tools hub in every locale, with buying a home", () => {
		for (const lang of SUPPORTED_LANGS) {
			const group = buildToolsHub(lang).find((entry) => entry.id === "borrowAndBuyHome")
			const tool = group?.tools.find((entry) => entry.routeId === "toolBuyVsRent")
			expect(tool?.href).toBe(toLocalizedPath("toolBuyVsRent", lang))
		}
	})

	it("has the same copy keys in every locale and in the public mirror", () => {
		const reference = keyPaths(readLocale("src/locales", "en").tools.buyVsRent).sort()

		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.buyVsRent
			expect(keyPaths(copy).sort()).toEqual(reference)
			expect(readLocale("public/locales", lang).tools.buyVsRent).toEqual(copy)
		}
	})

	it("labels every field and explains every error in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.buyVsRent
			expect(Object.keys(copy.fields).sort()).toEqual([...FIELDS].sort())
			for (const error of ERRORS) expect(copy.errors[error]).toBeTruthy()
		}
	})

	it("has a unique title and meta description per locale", () => {
		const copies = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).tools.buyVsRent)

		expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("closes with the net-worth plan as the next step", () => {
		expect(readLocale("src/locales", "en").tools.buyVsRent.ctaHeadline).toBe(
			"Follow the decision in your net-worth plan",
		)
		expect(readSource("../../components/pages/ToolDetailPage.astro")).toContain(
			'headline: t("tools.buyVsRent.ctaHeadline")',
		)
	})

	it("addresses the pt reader as tu", () => {
		const pt = JSON.stringify(readLocale("src/locales", "pt").tools.buyVsRent)

		// \b is ASCII-only, so it never matches next to "ê": use letter lookarounds.
		expect(pt).not.toMatch(/(?<!\p{L})(?:você|seu|sua|seus|suas)(?!\p{L})/iu)
	})

	it("reports use without amounts and stores nothing in the browser", () => {
		const source = readSource("../../components/calculators/BuyVsRentCalculatorComp.tsx")

		expect(source).toContain(
			'pushGtmEvent({ event: "tool_used", tool: "buy_vs_rent", page_type: getPageType() })',
		)
		expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/)
	})

	it("links the guide to the mortgage and net worth calculators", () => {
		const guide = readSource("../../components/calculators/BuyVsRentGuide.astro")

		expect(guide).toContain('toLocalizedPath("toolMortgage", locale)')
		expect(guide).toContain('toLocalizedPath("toolNetWorth", locale)')
	})

	it("has no FAQ structured data", () => {
		const sources = [
			readSource("../../components/calculators/BuyVsRentGuide.astro"),
			readSource("../../components/calculators/BuyVsRentCalculatorComp.tsx"),
		]
		for (const source of sources) expect(source).not.toMatch(/FAQPage/)
	})
})

describe("buy versus rent worked example", () => {
	// The guide's sentences describe this outcome; if the example changes, the copy must too.
	it("is the outcome the guide's copy describes", () => {
		const calculation = computeBuyVsRent(BUY_VS_RENT_EXAMPLE)
		if (!calculation.ok) throw new Error("invalid example")
		const { result } = calculation

		// "buying starts … behind"
		expect(result.years[0].difference).toBeLessThan(0)
		// "owning costs more than renting in every month, so the owner never has money left over"
		expect(result.firstMonthOwnerCost).toBeGreaterThan(result.firstMonthRent)
		for (const year of result.years) expect(year.ownerInvestments).toBe(0)
		// "buying ends … ahead" and "first pulls ahead at the end of year …"
		expect(result.difference).toBeGreaterThan(0)
		expect(result.breakEvenYear).not.toBeNull()
		// More than one year, so "after {{horizon}} years" reads right in every locale.
		expect(BUY_VS_RENT_EXAMPLE.horizonYears).toBeGreaterThan(1)

		const alternative = computeBuyVsRent({
			...BUY_VS_RENT_EXAMPLE,
			monthlyRent: BUY_VS_RENT_EXAMPLE_ALTERNATIVE_RENT,
		})
		if (!alternative.ok) throw new Error("invalid alternative")
		// "at a rent of … instead, renting is still … ahead"
		expect(alternative.result.difference).toBeLessThan(0)
	})
})

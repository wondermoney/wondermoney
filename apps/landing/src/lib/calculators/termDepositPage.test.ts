import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { getToolStaticPaths } from "../pageStaticPaths"
import {
	SUPPORTED_LANGS,
	resolveToolRouteId,
	resolveToolRouteIdFromLegacy,
	toLocalizedPath,
	toLocalizedPathname,
} from "../routes"
import { INTEREST_PAYOUTS } from "./termDeposit"
import { buildToolsHub } from "../toolsCatalog"

type ToolCopy = Record<string, unknown> & {
	pageTitle: string
	pageDescription: string
	ctaHeadline: string
	payouts: Record<string, string>
	taxRateHelp: string
	totalReceived: string
}

function readLocale(base: "src/locales" | "public/locales", lang: string) {
	const path = fileURLToPath(new URL(`../../../${base}/${lang}/common.json`, import.meta.url))
	return JSON.parse(readFileSync(path, "utf8")) as {
		tools: Record<string, ToolCopy>
	}
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

function placeholders(value: unknown): string[] {
	return [...JSON.stringify(value).matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort()
}

describe("term deposit tool page", () => {
	it("has a localized tool route in every locale", () => {
		const paths = SUPPORTED_LANGS.map((lang) => toLocalizedPath("toolTermDeposit", lang))

		expect(paths).toEqual([
			"/pt/tools/calculadora-depositos-a-prazo",
			"/en/tools/term-deposit-calculator",
			"/es/tools/calculadora-deposito-a-plazo",
			"/fr/tools/calculateur-depot-a-terme",
			"/de/tools/festgeld-rechner",
			"/it/tools/calcolatore-conto-deposito",
		])
		for (const lang of SUPPORTED_LANGS) {
			const slug = toLocalizedPath("toolTermDeposit", lang).split("/").pop() as string
			expect(resolveToolRouteId(lang, slug)).toBe("toolTermDeposit")
		}
	})

	it("is prerendered from the tool static paths in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const pages = getToolStaticPaths(lang).filter(
				(path) => path.props.routeId === "toolTermDeposit",
			)
			expect(pages).toHaveLength(1)
			expect(pages[0].params.tool).toBe(toLocalizedPath("toolTermDeposit", lang).split("/").pop())
		}
	})

	it("keeps the slug when switching language", () => {
		expect(toLocalizedPathname("/pt/tools/calculadora-depositos-a-prazo", "de")).toBe(
			"/de/tools/festgeld-rechner",
		)
	})

	it("can be linked from learn and glossary content", () => {
		expect(resolveToolRouteIdFromLegacy("calculadora-depositos-a-prazo", "en")).toBe("toolTermDeposit")
		expect(resolveToolRouteIdFromLegacy("termDepositCalculator", "pt")).toBe("toolTermDeposit")
		expect(resolveToolRouteIdFromLegacy("deposito-a-prazo", "it")).toBe("toolTermDeposit")
	})

	it("is listed on the tools hub in every locale, under invest and grow", () => {
		for (const lang of SUPPORTED_LANGS) {
			const group = buildToolsHub(lang).find((entry) => entry.id === "investAndGrow")
			const tool = group?.tools.find((entry) => entry.routeId === "toolTermDeposit")
			expect(tool?.key).toBe("termDeposit")
			expect(tool?.href).toBe(toLocalizedPath("toolTermDeposit", lang))
		}
	})

	it("renders the calculator, the guide and its own next step on the tool page", () => {
		const page = readSource("../../components/pages/ToolDetailPage.astro")

		expect(page).toContain('{routeId === "toolTermDeposit" && <TermDepositCalculatorComp locale={locale} client:load />}')
		expect(page).toContain('{routeId === "toolTermDeposit" && <TermDepositGuide locale={locale} />}')
		expect(page).toContain('headline: t("tools.termDeposit.ctaHeadline")')
		expect(readLocale("src/locales", "en").tools.termDeposit.ctaHeadline).toBe(
			"Track the maturity date and cash balance",
		)
	})

	it("links the guide to the compound interest and savings goal tools", () => {
		const guide = readSource("../../components/calculators/TermDepositGuide.astro")

		expect(guide).toContain('toLocalizedPath("toolCompoundInterest", locale)')
		expect(guide).toContain('toLocalizedPath("toolSavingsGoal", locale)')
	})

	it("has the same copy keys and placeholders in every locale and in the public mirror", () => {
		const reference = readLocale("src/locales", "en").tools.termDeposit

		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.termDeposit
			expect(keyPaths(copy).sort()).toEqual(keyPaths(reference).sort())
			expect(placeholders(copy)).toEqual(placeholders(reference))
			expect(Object.keys(copy.payouts).sort()).toEqual([...INTEREST_PAYOUTS].sort())
			expect(readLocale("public/locales", lang).tools.termDeposit).toEqual(copy)
		}
	})

	it("has a unique title and meta description per locale", () => {
		const copies = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).tools.termDeposit)

		expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("names no country's tax rate in the tax help", () => {
		for (const lang of SUPPORTED_LANGS) {
			expect(readLocale("src/locales", lang).tools.termDeposit.taxRateHelp).not.toMatch(/[1-9]\d*\s?%/)
		}
	})

	it("labels the paid-out total as received, not as a balance", () => {
		const source = readSource("../../components/calculators/TermDepositCalculatorComp.tsx")

		expect(source).toContain('periodic && !result.reinvested ? t(k("totalReceived")) : t(k("finalBalance"))')
		expect(readLocale("src/locales", "en").tools.termDeposit.totalReceived).toBe("Total received")
	})

	it("addresses the pt reader as tu", () => {
		const pt = JSON.stringify(readLocale("src/locales", "pt").tools.termDeposit)

		// \b is ASCII-only, so it never matches next to "ê": use letter lookarounds.
		expect(pt).not.toMatch(/(?<!\p{L})(?:você|seu|sua|seus|suas)(?!\p{L})/iu)
	})

	it("reports use without amounts and stores nothing in the browser", () => {
		const source = readSource("../../components/calculators/TermDepositCalculatorComp.tsx")

		expect(source).toContain(
			'pushGtmEvent({ event: "tool_used", tool: "term_deposit", page_type: getPageType() })',
		)
		expect(source.match(/pushGtmEvent\(/g)).toHaveLength(1)
		expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/)
	})
})

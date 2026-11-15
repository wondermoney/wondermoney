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

const expectedPaths: Record<Lang, string> = {
	pt: "/pt/tools/simulador-poupanca",
	en: "/en/tools/savings-goal-calculator",
	es: "/es/tools/simulador-ahorro",
	fr: "/fr/tools/simulateur-epargne",
	de: "/de/tools/sparziel-rechner",
	it: "/it/tools/simulatore-risparmio",
}

describe("savings goal tool page", () => {
	it.each(SUPPORTED_LANGS)("has a localized tool path in %s that resolves back", (lang) => {
		expect(toLocalizedPath("toolSavingsGoal", lang)).toBe(expectedPaths[lang])
		const slug = expectedPaths[lang].split("/").pop() as string
		expect(resolveToolRouteId(lang, slug)).toBe("toolSavingsGoal")
	})

	it("is prerendered once per locale, with no legacy redirect page", () => {
		for (const lang of SUPPORTED_LANGS) {
			const pages = getToolStaticPaths(lang).filter(
				(path) => path.props.routeId === "toolSavingsGoal",
			)
			expect(pages).toHaveLength(1)
			expect(pages[0].props.redirectTo).toBeUndefined()
			expect(pages[0].params.tool).toBe(expectedPaths[lang].split("/").pop())
		}
	})

	it("keeps the slug when switching language", () => {
		expect(toLocalizedPathname("/pt/tools/simulador-poupanca", "de")).toBe(
			"/de/tools/sparziel-rechner",
		)
		expect(toLocalizedPathname("/fr/tools/simulateur-epargne", "en")).toBe(
			"/en/tools/savings-goal-calculator",
		)
	})

	it("can be linked from learn and glossary content", () => {
		for (const value of ["toolSavingsGoal", "savingsGoalCalculator", "savings-goal", "simulador-poupanca"]) {
			expect(resolveToolRouteIdFromLegacy(value, "en")).toBe("toolSavingsGoal")
		}
		expect(resolveToolRouteIdFromLegacy("sparziel-rechner", "de")).toBe("toolSavingsGoal")
		// The savings rate calculator stays a different tool.
		expect(resolveToolRouteIdFromLegacy("taxa-poupanca", "pt")).toBe("toolSavingsRate")
	})

	it.each(SUPPORTED_LANGS)("is listed on the %s tools hub", (lang) => {
		expect(readSource(`../../pages/${lang}/tools/index.astro`)).toContain(
			'{ key: "savingsGoal", routeId: "toolSavingsGoal", available: true }',
		)
	})

	it("closes with its own next step into the app", () => {
		const page = readSource("../../components/pages/ToolDetailPage.astro")

		expect(page).toContain('headline: t("tools.savingsGoal.nextStepHeadline")')
		expect(readLocale("src/locales", "en").tools.savingsGoal.nextStepHeadline).toBe(
			"Turn the required contribution into a recurring goal",
		)
	})

	it("links the guide to the savings rate and compound interest tools", () => {
		const guide = readSource("../../components/calculators/SavingsGoalGuide.astro")

		expect(guide).toContain('routeId: "toolSavingsRate"')
		expect(guide).toContain('routeId: "toolCompoundInterest"')
	})

	it("reports use as tool_used with no amounts", () => {
		const component = readSource("../../components/calculators/SavingsGoalCalculatorComp.tsx")

		expect(component).toContain(
			'pushGtmEvent({ event: "tool_used", tool: "savings_goal", page_type: getPageType() })',
		)
	})

	it("has the same copy keys in every locale and in the public mirror", () => {
		const reference = keyPaths(readLocale("src/locales", "en").tools.savingsGoal).sort()

		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.savingsGoal
			expect(keyPaths(copy).sort()).toEqual(reference)
			expect(readLocale("public/locales", lang).tools.savingsGoal).toEqual(copy)
		}
	})

	it("uses the same placeholders in every locale", () => {
		const placeholders = (lang: Lang) => {
			const copy = readLocale("src/locales", lang).tools.savingsGoal
			return Object.fromEntries(
				keyPaths(copy).map((path) => {
					const text = path.split(".").reduce<unknown>(
						(node, key) => (node as Record<string, unknown>)[key],
						copy,
					) as string
					return [path, [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort()]
				}),
			)
		}
		const reference = placeholders("en")

		for (const lang of SUPPORTED_LANGS) expect(placeholders(lang)).toEqual(reference)
	})

	it("takes the default return and the 100-year cap from the calculation, not the copy", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.savingsGoal as Record<string, unknown> & {
				status: Record<string, string>
			}
			expect(copy.annualReturnHelp).toContain("{{rate}}")
			expect(copy.annualReturnHelp).not.toMatch(/\b2\b/)
			for (const text of [copy.periodHelp, copy.overMaxYears, copy.status.beyondHorizon]) {
				expect(text).toContain("{{maxYears}}")
				expect(text).not.toMatch(/\b100\b/)
			}
		}
	})

	it("has a unique title and meta description per locale", () => {
		const copies = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).tools.savingsGoal)

		expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("addresses the pt reader as tu", () => {
		const pt = JSON.stringify(readLocale("src/locales", "pt").tools.savingsGoal)

		expect(pt).not.toMatch(/\bvocê\b|\bseu\b|\bsua\b|\bseus\b|\bsuas\b/iu)
	})
})

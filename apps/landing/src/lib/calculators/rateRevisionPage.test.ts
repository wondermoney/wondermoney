import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
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

function readLocale(base: "src/locales" | "public/locales", lang: Lang) {
	const path = new URL(`../../../${base}/${lang}/common.json`, import.meta.url)
	return JSON.parse(readFileSync(path, "utf8")) as {
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

	it.each(SUPPORTED_LANGS)("is listed among the %s home-buying tools on the hub", (lang) => {
		const group = buildToolsHub(lang).find((candidate) => candidate.id === "borrowAndBuyHome")

		expect(group?.tools.find((tool) => tool.routeId === "toolRateRevision")).toMatchObject({
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

	it("exposes placeholders for the input limits in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = copyFor(lang)
			for (const limit of ["minBalance", "maxBalance", "maxYears", "minIndex", "maxIndex", "maxSpread"]) {
				expect(textAt(copy, "guide.limits")).toContain(`{{${limit}}}`)
			}
			for (const field of ["indexRate", "newIndexRate"]) {
				expect(textAt(copy, `errors.${field}.tooSmall`)).toContain("{{min}}")
				expect(textAt(copy, `errors.${field}.tooLarge`)).toContain("{{max}}")
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

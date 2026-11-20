import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { getToolStaticPaths } from "../pageStaticPaths"
import {
	SUPPORTED_LANGS,
	resolveCalculatorRouteIdFromLegacy,
	resolveToolRouteId,
	resolveToolRouteIdFromLegacy,
	toLocalizedPath,
	toLocalizedPathname,
} from "../routes"
import { getRelatedContentTools } from "../relatedContentTools"
import { getTranslations } from "../translations"
import { buildToolsHub } from "../toolsCatalog"

type ToolCopy = Record<string, unknown> & {
	pageTitle: string
	pageDescription: string
}

function readLocale(base: "src/locales" | "public/locales", lang: string) {
	const path = fileURLToPath(new URL(`../../../${base}/${lang}/common.json`, import.meta.url))
	return JSON.parse(readFileSync(path, "utf8")) as { tools: Record<string, ToolCopy> }
}

function keyPaths(value: unknown, prefix = ""): string[] {
	if (typeof value !== "object" || value === null) return [prefix]
	return Object.entries(value).flatMap(([key, child]) =>
		keyPaths(child, prefix ? `${prefix}.${key}` : key),
	)
}

describe("mortgage transfer tool page", () => {
	it("has a localized tool route in every locale", () => {
		const paths = SUPPORTED_LANGS.map((lang) => toLocalizedPath("toolMortgageTransfer", lang))

		expect(paths).toEqual([
			"/pt/tools/simulador-transferencia-credito-habitacao",
			"/en/tools/mortgage-switch-calculator",
			"/es/tools/cambiar-hipoteca-de-banco",
			"/fr/tools/rachat-credit-immobilier",
			"/de/tools/umschuldung-rechner",
			"/it/tools/surroga-mutuo",
		])
		for (const lang of SUPPORTED_LANGS) {
			const slug = toLocalizedPath("toolMortgageTransfer", lang).split("/").pop() as string
			expect(resolveToolRouteId(lang, slug)).toBe("toolMortgageTransfer")
		}
	})

	it("is prerendered from the tool static paths in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const pages = getToolStaticPaths(lang).filter(
				(path) => path.props.routeId === "toolMortgageTransfer",
			)
			expect(pages).toHaveLength(1)
			expect(pages[0].params.tool).toBe(
				toLocalizedPath("toolMortgageTransfer", lang).split("/").pop(),
			)
		}
	})

	it("keeps the slug when switching language", () => {
		expect(toLocalizedPathname("/pt/tools/simulador-transferencia-credito-habitacao", "it")).toBe(
			"/it/tools/surroga-mutuo",
		)
	})

	it("can be linked from learn and glossary content", () => {
		expect(resolveToolRouteIdFromLegacy("simulador-transferencia-credito-habitacao", "en")).toBe(
			"toolMortgageTransfer",
		)
		expect(resolveToolRouteIdFromLegacy("mortgageTransferCalculator", "pt")).toBe(
			"toolMortgageTransfer",
		)
	})

	it("adds a localized calculator link to related learn and glossary content", () => {
		for (const lang of SUPPORTED_LANGS) {
			const mortgage = resolveCalculatorRouteIdFromLegacy("loan-calculator", lang)
			expect(mortgage).toBe("toolMortgage")
			if (!mortgage) throw new Error("Missing mortgage route for the CMS calculator key")
			const items = [{ href: toLocalizedPath(mortgage, lang) }]
			const t = getTranslations(lang)
			const transfer = {
				href: toLocalizedPath("toolMortgageTransfer", lang),
				title: t("tools.mortgageTransfer.title"),
				description: "",
				type: "calculator",
			}
			expect(getRelatedContentTools(items, lang, t)).toContainEqual(transfer)
			expect(getRelatedContentTools([...items, transfer], lang, t)).not.toContainEqual(transfer)
		}
	})

	it("is listed on the tools hub in every locale, after early repayment", () => {
		for (const lang of SUPPORTED_LANGS) {
			const group = buildToolsHub(lang).find((entry) => entry.id === "borrowAndBuyHome")
			const routeIds = group?.tools.map((tool) => tool.routeId) ?? []
			expect(routeIds).toContain("toolMortgageTransfer")
			expect(routeIds.indexOf("toolMortgageTransfer")).toBe(routeIds.indexOf("toolEarlyRepayment") + 1)
			expect(group?.tools.find((tool) => tool.routeId === "toolMortgageTransfer")?.href).toBe(
				toLocalizedPath("toolMortgageTransfer", lang),
			)
		}
	})

	it("has the same copy keys in every locale and in the public mirror", () => {
		const reference = keyPaths(readLocale("src/locales", "en").tools.mortgageTransfer).sort()

		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.mortgageTransfer
			expect(keyPaths(copy).sort()).toEqual(reference)
			expect(readLocale("public/locales", lang).tools.mortgageTransfer).toEqual(copy)
		}
	})

	it("has a short name for the menus, and a unique title and meta description per locale", () => {
		const copies = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).tools.mortgageTransfer)

		for (const copy of copies) expect(copy.shortName).toEqual(expect.stringMatching(/\S/))
		expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("provides fee guidance and a fixed-rate assumption in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.mortgageTransfer as ToolCopy & {
				costs: { help: string }
				guide: { method: { assumptions: { fixedRate: string } } }
			}
			expect(copy.costs.help, lang).toMatch(/\S/)
			expect(copy.guide.method.assumptions.fixedRate, lang).toMatch(/\S/)
		}
	})

	it("addresses the pt reader as tu", () => {
		const pt = JSON.stringify(readLocale("src/locales", "pt").tools.mortgageTransfer)

		// \b is ASCII-only, so it never matches next to "ê": use letter lookarounds.
		expect(pt).not.toMatch(/(?<!\p{L})(?:você|seu|sua|seus|suas)(?!\p{L})/iu)
	})
})

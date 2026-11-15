import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { getTopLevelPageStaticPaths } from "../pageStaticPaths"
import {
	SUPPORTED_LANGS,
	getLocalizedSlug,
	resolveCalculatorRouteIdFromLegacy,
	toLocalizedPath,
	toLocalizedPathname,
} from "../routes"
import { buildToolsHub } from "../toolsCatalog"

// pageStaticPaths imports the Sanity client for the content routes; top-level paths never call it.
vi.mock("sanity:client", () => ({ sanityClient: { fetch: vi.fn() } }))

const landingRoot = fileURLToPath(new URL("../../../", import.meta.url))

type Copy = Record<string, unknown> & {
	tools: { fire: Record<string, unknown> }
	lp: { fireCalculator: Record<string, string> }
}

function readLocale(base: "src/locales" | "public/locales", lang: string): Copy {
	return JSON.parse(readFileSync(join(landingRoot, base, lang, "common.json"), "utf8")) as Copy
}

function keyPaths(value: unknown, prefix = ""): string[] {
	if (typeof value !== "object" || value === null) return [prefix]
	return Object.entries(value).flatMap(([key, child]) =>
		keyPaths(child, prefix ? `${prefix}.${key}` : key),
	)
}

function filesUnder(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name)
		return entry.isDirectory() ? filesUnder(path) : [path]
	})
}

describe("FIRE calculator page", () => {
	it("keeps its localized address in every locale", () => {
		expect(SUPPORTED_LANGS.map((lang) => toLocalizedPath("pageFireCalculator", lang))).toEqual([
			"/pt/calculadora-fire",
			"/en/fire-calculator",
			"/es/calculadora-fire",
			"/fr/calculateur-fire",
			"/de/fire-rechner",
			"/it/calcolatore-fire",
		])
		expect(toLocalizedPathname("/pt/calculadora-fire", "de")).toBe("/de/fire-rechner")
	})

	it("is prerendered from the top-level static paths in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const pages = getTopLevelPageStaticPaths(lang).filter(
				(path) => path.props.routeId === "pageFireCalculator" && !path.props.redirectTo,
			)
			expect(pages).toHaveLength(1)
			expect(pages[0].params.page).toBe(toLocalizedPath("pageFireCalculator", lang).split("/").pop())
		}
	})

	it("is listed on the tools hub in every locale, with its title and link", () => {
		for (const lang of SUPPORTED_LANGS) {
			const hubTools = buildToolsHub(lang).flatMap((group) => group.tools)
			const fire = hubTools.find((tool) => tool.routeId === "pageFireCalculator")

			expect(fire).toMatchObject({ key: "fire", href: toLocalizedPath("pageFireCalculator", lang) })
			// What the hub renders for the card: its title and description, and a link to the page.
			const copy = readLocale("src/locales", lang).tools.fire
			expect(copy.title).toEqual(expect.any(String))
			expect(copy.description).toEqual(expect.any(String))
			expect(toLocalizedPath("pageFireCalculator", lang)).toBe(`/${lang}/${getLocalizedSlug("pageFireCalculator", lang)}`)
		}
	})

	it("can be named as the related calculator of learn and glossary content", () => {
		for (const value of ["fire", "FIRE", "fireCalculator", "pageFireCalculator", "calculadora-fire", "fire-rechner"]) {
			expect(resolveCalculatorRouteIdFromLegacy(value, "en")).toBe("pageFireCalculator")
		}
		// Tools still resolve as before, and unknown names still fall back to the hub.
		expect(resolveCalculatorRouteIdFromLegacy("juros-compostos", "pt")).toBe("toolCompoundInterest")
		expect(resolveCalculatorRouteIdFromLegacy("mortgage-affordability", "en")).toBeUndefined()
		expect(resolveCalculatorRouteIdFromLegacy(undefined, "en")).toBeUndefined()
	})

	it("no longer sends visitors to an external calculator", () => {
		// The external FIRE calculator the page used to link to.
		const externalHost = ["fuckyou", "money"].join(".")
		const offenders = filesUnder(join(landingRoot, "src"))
			.concat(filesUnder(join(landingRoot, "public/locales")))
			.filter((file) => readFileSync(file, "utf8").includes(externalHost))

		expect(offenders).toEqual([])
	})

	it("has the same copy keys in every locale and in the public mirror", () => {
		const en = readLocale("src/locales", "en")
		const toolKeys = keyPaths(en.tools.fire).sort()
		const pageKeys = keyPaths(en.lp.fireCalculator).sort()

		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang)
			expect(keyPaths(copy.tools.fire).sort()).toEqual(toolKeys)
			expect(keyPaths(copy.lp.fireCalculator).sort()).toEqual(pageKeys)
			expect(readLocale("public/locales", lang)).toEqual(copy)
		}
	})

	it("uses the same placeholders in every locale", () => {
		const placeholders = (lang: string) =>
			Object.fromEntries(
				keyPaths(readLocale("src/locales", lang).tools.fire).map((path) => {
					const value = path
						.split(".")
						.reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], readLocale("src/locales", lang).tools.fire)
					return [path, [...String(value).matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort()]
				}),
			)
		const reference = placeholders("en")

		for (const lang of SUPPORTED_LANGS) {
			expect(placeholders(lang)).toEqual(reference)
		}
	})

	it("has a unique title and meta description per locale", () => {
		const copies = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).lp.fireCalculator)

		expect(new Set(copies.map((copy) => copy.metaTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.metaDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("says the amounts are in today's money and what it leaves out, in every locale", () => {
		const today = { en: "today", pt: "hoje", es: "hoy", fr: "aujourd'hui", de: "heutigen", it: "oggi" }

		for (const lang of SUPPORTED_LANGS) {
			const assumptions = String(readLocale("src/locales", lang).tools.fire.assumptions)
			expect(assumptions).toContain(today[lang])
		}
		expect(String(readLocale("src/locales", "en").tools.fire.assumptions)).toMatch(/taxes.*fees.*sequence risk/i)
	})

	it("addresses the pt reader as tu", () => {
		const pt = readLocale("src/locales", "pt")
		const copy = JSON.stringify([pt.tools.fire, pt.lp.fireCalculator])

		expect(copy).not.toMatch(/\bvocê\b|\bseu\b|\bsua\b/iu)
	})
})

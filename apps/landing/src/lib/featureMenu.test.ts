import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { FEATURE_MENU } from "./featureMenu"
import { FEATURE_ROUTE_IDS, SUPPORTED_LANGS, type Lang } from "./routes"

type HeaderCopy = { header: { nav: Record<string, { name?: unknown; description?: unknown }> } }

function readLocale(base: "src/locales" | "public/locales", lang: Lang): HeaderCopy {
	return JSON.parse(
		readFileSync(fileURLToPath(new URL(`../../${base}/${lang}/common.json`, import.meta.url)), "utf8"),
	) as HeaderCopy
}

describe("features menu", () => {
	it("lists every feature page exactly once, and nothing else", () => {
		const routeIds = FEATURE_MENU.map((item) => item.routeId)

		expect([...routeIds].sort()).toEqual([...FEATURE_ROUTE_IDS].sort())
		expect(new Set(routeIds).size).toBe(routeIds.length)
		expect(new Set(FEATURE_MENU.map((item) => item.key)).size).toBe(FEATURE_MENU.length)
	})

	it("gives every feature an icon", () => {
		for (const item of FEATURE_MENU) expect(item.icon, item.routeId).toBeTruthy()
	})

	it.each(SUPPORTED_LANGS)("has a name and a one-line description for every feature in %s", (lang) => {
		const nav = readLocale("src/locales", lang).header.nav

		for (const item of FEATURE_MENU) {
			expect(nav[item.key]?.name, `${lang} header.nav.${item.key}.name`).toEqual(expect.stringMatching(/^\S.{0,29}$/))
			// Short enough to stay within four lines in the menu's two columns.
			expect(nav[item.key]?.description, `${lang} header.nav.${item.key}.description`).toEqual(
				expect.stringMatching(/^\S.{0,139}$/),
			)
		}
		expect(readLocale("public/locales", lang).header.nav).toEqual(nav)
	})

	it("addresses the pt reader as tu", () => {
		const copy = JSON.stringify(
			FEATURE_MENU.map((item) => readLocale("src/locales", "pt").header.nav[item.key]),
		)

		expect(copy).not.toMatch(/\bvocê\b|\bseu\b|\bsua\b|\bseus\b|\bsuas\b/iu)
	})
})

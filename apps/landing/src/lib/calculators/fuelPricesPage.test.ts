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
import { getRelatedContentTools } from "../relatedContentTools"
import { buildToolsHub, getToolCatalogEntry, toolAnalyticsName } from "../toolsCatalog"

type ToolCopy = Record<string, unknown> & {
	pageTitle: string
	pageDescription: string
	cta: { headline: string }
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

describe("fuel prices tool page", () => {
	it("has a localized tool route in every locale", () => {
		const paths = SUPPORTED_LANGS.map((lang) => toLocalizedPath("toolFuelPrices", lang))

		expect(paths).toEqual([
			"/pt/tools/preco-dos-combustiveis",
			"/en/tools/fuel-prices-portugal",
			"/es/tools/precio-combustibles-portugal",
			"/fr/tools/prix-carburants-portugal",
			"/de/tools/kraftstoffpreise-portugal",
			"/it/tools/prezzi-carburanti-portogallo",
		])
		for (const lang of SUPPORTED_LANGS) {
			const slug = toLocalizedPath("toolFuelPrices", lang).split("/").pop() as string
			expect(resolveToolRouteId(lang, slug)).toBe("toolFuelPrices")
		}
	})

	it("is prerendered from the tool static paths in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const pages = getToolStaticPaths(lang).filter((path) => path.props.routeId === "toolFuelPrices")
			expect(pages).toHaveLength(1)
			expect(pages[0].params.tool).toBe(toLocalizedPath("toolFuelPrices", lang).split("/").pop())
		}
	})

	it("keeps the slug when switching language and resolves legacy links", () => {
		expect(toLocalizedPathname("/pt/tools/preco-dos-combustiveis", "de")).toBe(
			"/de/tools/kraftstoffpreise-portugal",
		)
		expect(resolveToolRouteIdFromLegacy("fuel-prices", "en")).toBe("toolFuelPrices")
	})

	it("is listed on the tools hub in every locale, in the budget group", () => {
		for (const lang of SUPPORTED_LANGS) {
			const hub = buildToolsHub(lang)
			expect(hub.find((group) => group.id === "budgetAndSave")?.tools.map((tool) => tool.routeId)).toContain(
				"toolFuelPrices",
			)
		}
		expect(toolAnalyticsName("fuelPrices")).toBe("fuel_prices")
	})

	it("is linked from the household budget, car loan and vehicle tax tools", () => {
		for (const source of ["toolHouseholdBudget", "toolCarLoan", "toolVehicleTax"] as const) {
			expect(
				getRelatedContentTools([{ href: toLocalizedPath(source, "en") }], "en", () => "x").map((item) => item.href),
			).toContain(toLocalizedPath("toolFuelPrices", "en"))
			expect(getToolCatalogEntry(source).routeId).toBe(source)
		}
		expect(getToolCatalogEntry("toolFuelPrices").related).toEqual([
			"toolHouseholdBudget",
			"toolCarLoan",
			"toolVehicleTax",
		])
	})

	it("renders the guide and the component from the tool detail page and links the guide onwards", () => {
		const page = readSource("../../components/pages/ToolDetailPage.astro")
		expect(page).toContain('routeId === "toolFuelPrices" && <FuelPricesComp')
		expect(page).toContain('routeId === "toolFuelPrices" && <FuelPricesGuide')
		const guide = readSource("../../components/calculators/FuelPricesGuide.astro")
		expect(guide).toContain('toLocalizedPath("toolHouseholdBudget", locale)')
		expect(guide).toContain('toLocalizedPath("toolCarLoan", locale)')
		expect(guide).toContain('toLocalizedPath("toolVehicleTax", locale)')
	})

	it("has the same copy keys in every locale and in the public mirror", () => {
		const reference = keyPaths(readLocale("src/locales", "en").tools.fuelPrices).sort()

		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.fuelPrices
			expect(keyPaths(copy).sort()).toEqual(reference)
			expect(readLocale("public/locales", lang).tools.fuelPrices).toEqual(copy)
		}
	})

	it("has a unique title and meta description per locale", () => {
		const copies = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).tools.fuelPrices)

		expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("names DGEG, dates every figure and says in every locale that it does not forecast", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.fuelPrices as unknown as {
				latest: { asOf: string; note: string }
				history: { asOf: string }
				guide: { data: { dgeg: string; terms: string; refresh: string }; read: { noForecast: string } }
			}
			expect(copy.latest.asOf).toContain("{{date}}")
			expect(copy.latest.asOf).toContain("DGEG")
			expect(copy.latest.asOf).toContain("{{previous}}")
			expect(copy.history.asOf).toContain("{{date}}")
			expect(copy.history.asOf).toContain("{{fetched}}")
			expect(copy.history.asOf).toContain("DGEG")
			expect(copy.guide.data.dgeg).toContain("{{asOf}}")
			expect(copy.guide.data.terms).toContain("DGEG")
			expect(copy.guide.data.refresh).toContain("{{asOf}}")
			expect(copy.latest.note).toBeTruthy()
			expect(copy.guide.read.noForecast).toBeTruthy()
		}
		const en = readLocale("src/locales", "en").tools.fuelPrices as unknown as { latest: { note: string } }
		expect(en.latest.note).toContain("not a forecast")
	})

	it("names no station or brand in its own copy: station names come from DGEG's data", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = JSON.stringify(readLocale("src/locales", lang).tools.fuelPrices)
			expect(copy).not.toMatch(/\b(Galp|Repsol|BP|Cepsa|Moeve|Prio|Shell|Intermarch[eé]|Continente|Auchan)\b/)
		}
	})

	it("dates the station snapshot, names DGEG and offers the goal next step, in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.fuelPrices as unknown as {
				stations: Record<string, string>
				guide: { data: { stations: string; stationsRefresh: string } }
			}
			expect(copy.stations.asOf).toContain("{{date}}")
			expect(copy.stations.asOf).toContain("{{time}}")
			expect(copy.stations.asOf).toContain("DGEG")
			expect(copy.stations.stale).toContain("{{days}}")
			expect(copy.stations.updated).toContain("{{date}}")
			expect(copy.stations.note).toContain("DGEG")
			expect(copy.guide.data.stations).toContain("{{stationsDate}}")
			expect(copy.guide.data.stationsRefresh).toContain("{{stationsDate}}")
		}
		expect(readLocale("src/locales", "en").tools.fuelPrices.stations).toMatchObject({
			nextStepCta: "Save the monthly difference toward a goal",
		})
	})

	it("lists stations without asking where the visitor is or sending anything about them", () => {
		const source = readSource("../../components/calculators/CheapestStations.tsx")
		expect(source).toContain('pushGtmEvent({ event: "tool_used", tool: "fuel_stations", page_type: getPageType() })')
		expect(source).toContain('toLocalizedPath("featureGoals", locale)')
		expect(source).not.toMatch(/geolocation|localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/)
		expect(readSource("../../components/calculators/FuelPricesComp.tsx")).toContain("<CheapestStations />")
	})

	it("asks for a review of the transport allowance as the next step, in every locale", () => {
		expect(readLocale("src/locales", "en").tools.fuelPrices.nextStepCta).toBe(
			"Review the transport allowance in your budget",
		)
		expect(readSource("../../components/pages/ToolDetailPage.astro")).toContain(
			't("tools.fuelPrices.nextStepCta")',
		)
		for (const lang of SUPPORTED_LANGS) {
			expect(String(readLocale("src/locales", lang).tools.fuelPrices.nextStepCta).length).toBeGreaterThan(10)
		}
	})

	it("addresses the pt reader as tu", () => {
		const pt = JSON.stringify(readLocale("src/locales", "pt").tools.fuelPrices)

		expect(pt).not.toMatch(/(?<!\p{L})(?:você|seu|sua|seus|suas)(?!\p{L})/iu)
	})

	it("reports use without inputs or results, stores nothing and never fetches at runtime", () => {
		const source = readSource("../../components/calculators/FuelPricesComp.tsx")

		expect(source).toContain(
			'pushGtmEvent({ event: "tool_used", tool: "fuel_prices", page_type: getPageType() })',
		)
		expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/)
	})
})

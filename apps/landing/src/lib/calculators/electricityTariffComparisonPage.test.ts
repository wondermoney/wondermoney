import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { OMIE_PRICES_SOURCE } from "./data/omiePrices"
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

const ROUTE = "toolElectricityTariffComparison"

type Copy = Record<string, unknown> & { pageTitle: string; pageDescription: string }

function readLocale(base: "src/locales" | "public/locales", lang: string) {
	const path = fileURLToPath(new URL(`../../../${base}/${lang}/common.json`, import.meta.url))
	return JSON.parse(readFileSync(path, "utf8")) as { tools: Record<string, Copy> }
}

function readSource(relativePath: string) {
	return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
}

function keyPaths(value: unknown, prefix = ""): string[] {
	if (typeof value !== "object" || value === null) return [prefix]
	return Object.entries(value).flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key))
}

function leaves(value: unknown, prefix = ""): [string, string][] {
	if (typeof value === "string") return [[prefix, value]]
	if (typeof value !== "object" || value === null) return []
	return Object.entries(value).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key))
}

const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort()

describe("electricity tariff comparison page", () => {
	it("has a localized tool route in every locale", () => {
		expect(SUPPORTED_LANGS.map((lang) => toLocalizedPath(ROUTE, lang))).toEqual([
			"/pt/tools/comparador-tarifarios-eletricidade",
			"/en/tools/electricity-tariff-comparison",
			"/es/tools/comparador-tarifas-electricidad-portugal",
			"/fr/tools/comparateur-tarifs-electricite-portugal",
			"/de/tools/stromtarifvergleich-portugal",
			"/it/tools/confronto-tariffe-elettricita-portogallo",
		])
		for (const lang of SUPPORTED_LANGS) {
			const slug = toLocalizedPath(ROUTE, lang).split("/").pop() as string
			expect(resolveToolRouteId(lang, slug)).toBe(ROUTE)
		}
	})

	it("is prerendered from the tool static paths in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const pages = getToolStaticPaths(lang).filter((path) => path.props.routeId === ROUTE)
			expect(pages).toHaveLength(1)
			expect(pages[0].params.tool).toBe(toLocalizedPath(ROUTE, lang).split("/").pop())
		}
	})

	it("keeps the slug when switching language and resolves legacy links", () => {
		expect(toLocalizedPathname("/pt/tools/comparador-tarifarios-eletricidade", "de")).toBe(
			"/de/tools/stromtarifvergleich-portugal",
		)
		expect(resolveToolRouteIdFromLegacy("electricity-tariff-comparison", "pt")).toBe(ROUTE)
	})

	it("is on the tools hub in the budget group, next to the electricity index", () => {
		for (const lang of SUPPORTED_LANGS) {
			const tools = buildToolsHub(lang).find((group) => group.id === "budgetAndSave")?.tools.map((tool) => tool.routeId) ?? []
			expect(tools.indexOf(ROUTE)).toBe(tools.indexOf("toolElectricityIndex") + 1)
		}
		expect(toolAnalyticsName("electricityTariffComparison")).toBe("electricity_tariff_comparison")
		expect(getToolCatalogEntry(ROUTE).related).toEqual(["toolElectricityIndex", "toolHouseholdBudget", "toolEmergencyFund"])
	})

	it("is linked from the electricity index and household budget content", () => {
		for (const source of ["toolElectricityIndex", "toolHouseholdBudget"] as const) {
			expect(
				getRelatedContentTools([{ href: toLocalizedPath(source, "en") }], "en", () => "x").map((item) => item.href),
			).toContain(toLocalizedPath(ROUTE, "en"))
		}
	})

	it("renders the island and the guide from the tool detail page", () => {
		const page = readSource("../../components/pages/ToolDetailPage.astro")
		expect(page).toContain(`routeId === "${ROUTE}" && <ElectricityTariffComparisonComp locale={locale} client:load />`)
		expect(page).toContain(`routeId === "${ROUTE}" && <ElectricityTariffComparisonGuide`)
		expect(page).toContain('t("tools.electricityTariffComparison.nextStepHeadline")')
	})

	it("loads the offers with a dynamic import, in the island only", () => {
		const island = readSource("../../components/calculators/ElectricityTariffComparisonComp.tsx")
		expect(island).toContain('import("@/lib/calculators/data/electricityOffers")')
		const helpers = readSource("./electricityTariffComparator.ts")
		expect(helpers).not.toMatch(/import[^;]*data\/electricityOffers/)
	})

	it("has the same copy keys and placeholders in every locale, and the public mirror", () => {
		const en = readLocale("src/locales", "en").tools.electricityTariffComparison
		const reference = keyPaths(en).sort()
		const enLeaves = new Map(leaves(en))
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.electricityTariffComparison
			expect(keyPaths(copy).sort(), lang).toEqual(reference)
			for (const [path, text] of leaves(copy)) {
				expect(placeholders(text), `${lang} ${path}`).toEqual(placeholders(enLeaves.get(path) as string))
			}
			expect(readLocale("public/locales", lang).tools.electricityTariffComparison).toEqual(copy)
		}
	})

	it("has a unique title and meta description per locale", () => {
		const copies = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).tools.electricityTariffComparison)
		expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("cites ERSE with the export date, calls indexed prices estimates and leaves out the DGEG fee, in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.electricityTariffComparison as unknown as {
				source: Record<string, string>
				guide: { data: { erse: string } }
			}
			expect(copy.source.asOf).toContain("ERSE")
			expect(copy.source.asOf).toContain("{{date}}")
			expect(copy.source.indexed).toContain("ERSE")
			expect(copy.source.dgeg).toContain("DGEG")
			expect(copy.source.negotiation).toBeTruthy()
			expect(copy.guide.data.erse).toContain("{{date}}")
		}
	})

	it("says where the solar production estimate comes from, in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools.electricityTariffComparison as unknown as {
				solar: { summary: Record<string, string> }
			}
			for (const placeholder of ["{{version}}", "{{database}}", "{{from}}", "{{to}}", "{{date}}"]) {
				expect(copy.solar.summary.source, lang).toContain(placeholder)
			}
			expect(copy.solar.summary.source, lang).toContain("PVGIS")
		}
	})

	it("addresses the pt reader as tu", () => {
		const pt = JSON.stringify(readLocale("src/locales", "pt").tools.electricityTariffComparison)
		expect(pt).not.toMatch(/(?<!\p{L})(?:você|seu|sua|seus|suas)(?!\p{L})/iu)
	})

	it("addresses the de reader as Sie", () => {
		const de = JSON.stringify(readLocale("src/locales", "de").tools.electricityTariffComparison)
		expect(de).not.toMatch(/(?<!\p{L})(?:du|dein|deine|deinen|deinem|deiner|dir|dich)(?!\p{L})/iu)
	})

	it("reports use without inputs or results, stores nothing and fetches only its own data files", () => {
		const files = ["ElectricityTariffComparisonComp.tsx", "ElectricityTariffResults.tsx", "ElectricitySolarPanel.tsx"].map((name) =>
			readSource(`../../components/calculators/${name}`),
		)
		expect(files[0]).toContain(
			'pushGtmEvent({ event: "tool_used", tool: "electricity_tariff_comparison", page_type: getPageType() })',
		)
		// The one fetch: the OMIE quarter-hour prices, a static file on the site's own origin, a plain
		// GET that sends nothing of the visitor's.
		expect(files[0].match(/fetch\(/g)).toHaveLength(1)
		expect(files[0]).toContain("const response = await fetch(path);")
		expect(OMIE_PRICES_SOURCE.quarterHoursPath).toMatch(/^\/data\/[\w-]+\.json$/)
		const others = [files[0].replace("await fetch(path)", ""), ...files.slice(1)]
		for (const source of others) expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/)
	})

	it("reads the invoice PDF in the browser, with pdf.js loaded only when a file is chosen and nothing sent", () => {
		const reader = readSource("./invoicePdf.ts")
		expect(reader).toContain('import("pdfjs-dist/legacy/build/pdf.mjs")')
		expect(reader).toContain('import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")')
		expect(reader).not.toMatch(/cMapUrl|standardFontDataUrl|wasmUrl|iccUrl/)
		const sources = [
			reader,
			readSource("./electricityInvoice.ts"),
			readSource("../../components/calculators/ElectricityInvoiceUpload.tsx"),
			// Its one fetch, the site's own OMIE price file, is checked in the test above.
			readSource("../../components/calculators/ElectricityTariffComparisonComp.tsx").replace("await fetch(path)", ""),
		]
		for (const source of sources) {
			expect(source).not.toMatch(/^import[^;]*pdfjs-dist/m)
			expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|sendBeacon/)
		}
	})

	it("uses no data or text from tiagofelicia.pt", () => {
		const root = fileURLToPath(new URL("../../../", import.meta.url))
		const files = (dir: string): string[] =>
			readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
				entry.name === "node_modules" || entry.name.startsWith(".") || entry.name === "dist"
					? []
					: entry.isDirectory()
						? files(join(dir, entry.name))
						: [join(dir, entry.name)],
			)
		const ours = files(join(root, "src")).filter((file) => /electricity(Tariff|Suppliers)|ElectricityTariff/.test(file) && !file.endsWith(".test.ts"))
		expect(ours.length).toBeGreaterThan(4)
		for (const file of ours) expect(readFileSync(file, "utf8")).not.toMatch(/tiagofelicia/i)
	})
})

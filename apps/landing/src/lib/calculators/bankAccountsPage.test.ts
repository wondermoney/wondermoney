import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { getToolStaticPaths } from "../pageStaticPaths"
import { SUPPORTED_LANGS, resolveToolRouteId, toLocalizedPath, toLocalizedPathname } from "../routes"
import { getRelatedContentTools } from "../relatedContentTools"
import { buildToolsHub, getToolCatalogEntry, toolAnalyticsName } from "../toolsCatalog"

vi.mock("sanity:client", () => ({ sanityClient: { fetch: vi.fn() } }))

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

const PAGES = [
	{
		routeId: "toolFreeBankAccounts",
		key: "freeBankAccounts",
		group: "budgetAndSave",
		component: "FreeBankAccountsComp.tsx",
		guide: "FreeBankAccountsGuide.astro",
		slugs: [
			"/pt/tools/contas-bancarias-gratuitas",
			"/en/tools/free-bank-accounts-portugal",
			"/es/tools/cuentas-bancarias-gratuitas-portugal",
			"/fr/tools/comptes-bancaires-gratuits-portugal",
			"/de/tools/kostenlose-bankkonten-portugal",
			"/it/tools/conti-bancari-gratuiti-portogallo",
		],
		cta: "See all your accounts in one place",
		event: "free_bank_accounts",
	},
	{
		routeId: "toolRemuneratedAccounts",
		key: "remuneratedAccounts",
		group: "investAndGrow",
		component: "RemuneratedAccountsComp.tsx",
		guide: "RemuneratedAccountsGuide.astro",
		slugs: [
			"/pt/tools/contas-remuneradas",
			"/en/tools/savings-accounts-portugal-comparison",
			"/es/tools/cuentas-remuneradas-portugal",
			"/fr/tools/comptes-remuneres-portugal",
			"/de/tools/verzinste-konten-portugal",
			"/it/tools/conti-remunerati-portogallo",
		],
		cta: "Move from the benchmark to a personal savings plan",
		event: "remunerated_accounts",
	},
] as const

describe.each(PAGES)("$key tool page", (page) => {
	it("has a localized tool route in every locale and is prerendered", () => {
		expect(SUPPORTED_LANGS.map((lang) => toLocalizedPath(page.routeId, lang))).toEqual(page.slugs)
		for (const lang of SUPPORTED_LANGS) {
			const slug = toLocalizedPath(page.routeId, lang).split("/").pop() as string
			expect(resolveToolRouteId(lang, slug)).toBe(page.routeId)
			const pages = getToolStaticPaths(lang).filter((path) => path.props.routeId === page.routeId)
			expect(pages).toHaveLength(1)
		}
		expect(toLocalizedPathname(page.slugs[0], "de")).toBe(page.slugs[4])
	})

	it("is on the tools hub in its group, in every locale", () => {
		for (const lang of SUPPORTED_LANGS) {
			const hub = buildToolsHub(lang)
			expect(hub.find((group) => group.id === page.group)?.tools.map((tool) => tool.routeId)).toContain(page.routeId)
		}
		expect(toolAnalyticsName(page.key)).toBe(page.event)
	})

	it("has the same copy keys in every locale and in the public mirror, with unique titles", () => {
		const reference = keyPaths(readLocale("src/locales", "en").tools[page.key]).sort()
		for (const lang of SUPPORTED_LANGS) {
			const copy = readLocale("src/locales", lang).tools[page.key]
			expect(keyPaths(copy).sort()).toEqual(reference)
			expect(readLocale("public/locales", lang).tools[page.key]).toEqual(copy)
		}
		const copies = SUPPORTED_LANGS.map((lang) => readLocale("src/locales", lang).tools[page.key])
		expect(new Set(copies.map((copy) => copy.pageTitle)).size).toBe(SUPPORTED_LANGS.length)
		expect(new Set(copies.map((copy) => copy.pageDescription)).size).toBe(SUPPORTED_LANGS.length)
	})

	it("offers its next step and addresses the pt reader as tu", () => {
		expect(readLocale("src/locales", "en").tools[page.key].nextStepCta).toBeTruthy()
		expect((readLocale("src/locales", "en").tools[page.key] as { nextStepHeadline: string }).nextStepHeadline).toBe(
			page.cta,
		)
		expect(readSource("../../components/pages/ToolDetailPage.astro")).toContain(
			`t("tools.${page.key}.nextStepHeadline")`,
		)
		const pt = JSON.stringify(readLocale("src/locales", "pt").tools[page.key])
		expect(pt).not.toMatch(/(?<!\p{L})(?:você|seu|sua|seus|suas)(?!\p{L})/iu)
	})

	it("reports use without inputs or results, stores nothing and fetches nothing at runtime", () => {
		const source = readSource(`../../components/calculators/${page.component}`)
		expect(source).toContain(
			`pushGtmEvent({ event: "tool_used", tool: "${page.event}", page_type: getPageType() })`,
		)
		expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|fetch\(/)
	})
})

describe("shared bank account copy", () => {
	it("has the same keys in every locale and states date, caution, guarantee, tax and no affiliate links", () => {
		const reference = keyPaths(readLocale("src/locales", "en").tools.bankAccountsShared).sort()
		for (const lang of SUPPORTED_LANGS) {
			const shared = readLocale("src/locales", lang).tools.bankAccountsShared as unknown as {
				asOf: string
				guarantee: { body: string }
				foreignTax: { body: string }
				educational: string
			}
			expect(keyPaths(shared).sort()).toEqual(reference)
			expect(readLocale("public/locales", lang).tools.bankAccountsShared).toEqual(shared)
			expect(shared.asOf).toContain("{{date}}")
			expect(shared.guarantee.body).toContain("{{amount}}")
			expect(shared.foreignTax.body).toContain("28")
			expect(shared.educational.length).toBeGreaterThan(60)
		}
	})

	it("renders the date and notices from the shared component and cites the deposit guarantee fund", () => {
		const common = readSource("../../components/calculators/BankAccountsCommon.tsx")
		expect(common).toContain("formatMonth")
		expect(common).not.toMatch(/Intl\.DateTimeFormat/)
		expect(common).toContain("DEPOSIT_GUARANTEE.url")
		expect(readSource("./data/bankAccountsSource.ts")).toContain("https://www.fgd.pt/en")
	})
})

describe("links between the account pages and their neighbours", () => {
	it("links the remunerated accounts page with the benchmark, certificates, term deposit and budget", () => {
		const guide = readSource("../../components/calculators/RemuneratedAccountsGuide.astro")
		for (const routeId of ["toolDepositRateIndex", "toolSavingsCertificates", "toolTermDeposit", "toolHouseholdBudget"] as const) {
			expect(guide).toContain(`toLocalizedPath("${routeId}", locale)`)
			expect(getToolCatalogEntry("toolRemuneratedAccounts").related).toContain(routeId)
			expect(
				getRelatedContentTools([{ href: toLocalizedPath(routeId, "en") }], "en", () => "x").map((item) => item.href),
			).toContain(toLocalizedPath("toolRemuneratedAccounts", "en"))
		}
		for (const routeId of ["toolDepositRateIndex", "toolSavingsCertificates", "toolTermDeposit", "toolHouseholdBudget"] as const) {
			expect(getToolCatalogEntry(routeId).related).toContain("toolRemuneratedAccounts")
		}
	})

	it("links the free accounts page to the remunerated one and the household budget", () => {
		const guide = readSource("../../components/calculators/FreeBankAccountsGuide.astro")
		expect(guide).toContain('toLocalizedPath("toolRemuneratedAccounts", locale)')
		expect(guide).toContain('toLocalizedPath("toolHouseholdBudget", locale)')
		expect(getToolCatalogEntry("toolHouseholdBudget").related).toContain("toolFreeBankAccounts")
		expect(
			getRelatedContentTools([{ href: toLocalizedPath("toolHouseholdBudget", "en") }], "en", () => "x").map(
				(item) => item.href,
			),
		).toContain(toLocalizedPath("toolFreeBankAccounts", "en"))
	})
})

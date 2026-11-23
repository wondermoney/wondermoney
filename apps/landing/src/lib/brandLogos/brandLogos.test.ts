import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { FREE_BANK_ACCOUNTS } from "@/lib/calculators/data/freeBankAccounts"
import { TERM_DEPOSIT_OFFERS } from "@/lib/calculators/data/termDepositOffers"
import { BRAND_LOGOS, brandMonogram, findBrandLogo, logoSrc, normaliseBrandName } from "./index"

const ASSETS = join(import.meta.dirname, "../../assets/brands")

/** Banks with no usable official square mark: they show the monogram. Listed in the pull request. */
const BANKS_ON_MONOGRAM = ["Easisave"]

describe("normaliseBrandName", () => {
	it("ignores case, accents, spaces and punctuation", () => {
		expect(normaliseBrandName("Activo Bank")).toBe("activobank")
		expect(normaliseBrandName("ActivoBank")).toBe("activobank")
		expect(normaliseBrandName("  ACTIVO-bank. ")).toBe("activobank")
		expect(normaliseBrandName("Caixa Geral de Depósitos")).toBe(normaliseBrandName("caixa geral de depositos"))
		expect(normaliseBrandName("moey!")).toBe("moey")
		expect(normaliseBrandName("N26")).toBe("n26")
	})
})

describe("findBrandLogo", () => {
	it("resolves the spelling variants in the data to one entry", () => {
		const entry = findBrandLogo("ActivoBank")
		expect(entry?.name).toBe("ActivoBank")
		expect(findBrandLogo("Activo Bank")).toBe(entry)
		expect(findBrandLogo("activobank")).toBe(entry)
		expect(findBrandLogo("Novo Banco")).toBe(findBrandLogo("Novobanco"))
		expect(findBrandLogo("Caixa Geral de Depositos")).toBe(findBrandLogo("CGD"))
	})

	it("returns null for a brand without a logo", () => {
		expect(findBrandLogo("Easisave")).toBeNull()
		expect(findBrandLogo("")).toBeNull()
		expect(findBrandLogo("Banco que não existe")).toBeNull()
	})
})

describe("brandMonogram", () => {
	it("takes the first letters of two words, or the first two letters of one", () => {
		expect(brandMonogram("Easisave")).toBe("EA")
		expect(brandMonogram("BAI Europa")).toBe("BE")
		expect(brandMonogram("banco ctt")).toBe("BC")
		expect(brandMonogram("Évora Energia")).toBe("ÉE")
		expect(brandMonogram("N26")).toBe("N2")
		expect(brandMonogram("moey!")).toBe("MO")
	})

	it("falls back to a question mark for a name with no letters", () => {
		expect(brandMonogram("")).toBe("?")
		expect(brandMonogram(" · ")).toBe("?")
	})
})

describe("the registry", () => {
	it("maps each normalised name and alias to one entry only", () => {
		const seen = new Map<string, string>()
		for (const entry of BRAND_LOGOS) {
			for (const name of [entry.name, ...(entry.aliases ?? [])]) {
				const key = normaliseBrandName(name)
				expect(key, name).not.toBe("")
				expect(seen.get(key), `${name} is also ${seen.get(key)}`).toBeUndefined()
				seen.set(key, entry.name)
			}
		}
	})

	it("records an https source for every logo and keeps its file in the category's folder", () => {
		for (const entry of BRAND_LOGOS) {
			expect(entry.source, entry.name).toMatch(/^https:\/\/[^\s]+$/)
			expect(logoSrc(entry.logo), entry.name).toContain(`/brands/${entry.category}/`)
		}
	})

	it("keeps every logo file small, and uses every file", () => {
		const used = new Set(BRAND_LOGOS.map((entry) => logoSrc(entry.logo).split("?")[0].split("/brands/")[1]))
		for (const category of readdirSync(ASSETS)) {
			for (const file of readdirSync(join(ASSETS, category))) {
				expect(statSync(join(ASSETS, category, file)).size, file).toBeLessThan(8 * 1024)
				expect(used.has(`${category}/${file}`), `${category}/${file} has no registry entry`).toBe(true)
			}
		}
	})

	it("has a logo for every bank on the bank tools, apart from the listed monograms", () => {
		const banks = new Set([...FREE_BANK_ACCOUNTS.map((account) => account.bank), ...TERM_DEPOSIT_OFFERS.map((offer) => offer.bank)])
		const missing = [...banks].filter((bank) => findBrandLogo(bank) === null).sort()
		expect(missing).toEqual(BANKS_ON_MONOGRAM)
	})
})

describe("the brokers", () => {
	it("has a square logo for each broker the product imports portfolio files from", () => {
		expect(findBrandLogo("DEGIRO")?.category).toBe("brokers")
		expect(findBrandLogo("Interactive Brokers")?.category).toBe("brokers")
		expect(findBrandLogo("IBKR")).toBe(findBrandLogo("Interactive Brokers"))
	})
})

describe("fuel station brands", () => {
	/** The main brands as DGEG writes them, each with a tile in the fuel category. */
	const FUEL_BRANDS_WITH_LOGO = [
		"ALVES BANDEIRA", "AUCHAN", "BP", "INTERMARCHÉ", "LECLERC", "MOEVE",
		"OZ Energia", "PINGO DOCE", "PLENERGY", "PRIO", "Q8", "SHELL",
	]
	/** Fuel brands that also sell electricity: their tiles belong to the electricity category. */
	const FROM_ANOTHER_CATEGORY = ["GALP", "REPSOL"]
	/** No official mark (Cepsa became Moeve), DGEG's word for an unbranded station, a local brand. */
	const FUEL_ON_MONOGRAM = ["CEPSA", "Genérico", "FREITAS"]

	it("has a fuel tile for every main brand, matched as DGEG spells it", () => {
		for (const brand of FUEL_BRANDS_WITH_LOGO) expect(findBrandLogo(brand)?.category, brand).toBe("fuel")
	})

	it("leaves the brands that also sell electricity to that category, and the rest to the monogram", () => {
		for (const brand of FROM_ANOTHER_CATEGORY) expect(findBrandLogo(brand)?.category, brand).not.toBe("fuel")
		for (const brand of FUEL_ON_MONOGRAM) expect(findBrandLogo(brand), brand).toBeNull()
	})
})

import { describe, expect, it } from "vitest"
import { ELECTRICITY_OFFERS } from "@/lib/calculators/data/electricityOffers"
import { ELECTRICITY_SUPPLIER_NAMES, supplierName } from "@/lib/calculators/electricitySuppliers"
import { ELECTRICITY_LOGOS } from "./electricity"
import { findBrandLogo } from "./index"

/**
 * Suppliers with no usable official square mark: they show the monogram. Listed in the pull
 * request. The regulated tariff is not a brand: the page labels it by name and it takes the
 * monogram too.
 */
const SUPPLIERS_ON_MONOGRAM = ["Endesa", "Iberdrola"]

describe("electricity supplier logos", () => {
	it("has a logo for every supplier in the offers snapshot, apart from the listed monograms", () => {
		// A supplier code a refresh adds without a name shows as the code, which matches no logo.
		const names = new Set(ELECTRICITY_OFFERS.filter((offer) => !offer.regulated).map((offer) => supplierName(offer.supplier)))
		const missing = [...names].filter((name) => findBrandLogo(name) === null).sort()
		expect(missing).toEqual(SUPPLIERS_ON_MONOGRAM)
	})

	it("has a logo for every named supplier, so the monogram list stays short", () => {
		const named = Object.values(ELECTRICITY_SUPPLIER_NAMES).filter((name) => !SUPPLIERS_ON_MONOGRAM.includes(name))
		for (const name of named) expect(findBrandLogo(name)?.category, name).toBe("electricity")
	})

	it("registers only suppliers the comparator names", () => {
		const named = new Set<string>(Object.values(ELECTRICITY_SUPPLIER_NAMES))
		for (const entry of ELECTRICITY_LOGOS) expect(named.has(entry.name), entry.name).toBe(true)
	})
})

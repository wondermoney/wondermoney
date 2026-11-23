import { BANK_LOGOS } from "./banks"
import { BROKER_LOGOS } from "./brokers"
import type { BrandLogoEntry } from "./types"

export type { BrandCategory, BrandLogoEntry } from "./types"

/**
 * Brand logos for the data tools and the product previews (banks and brokers; fuel and electricity
 * brands to follow), committed as local assets: no logo API, no hotlinking. To add a brand, put
 * its tile in `src/assets/brands/<category>/` and an entry in that category's module, with the
 * URL it was downloaded from. A new category is a folder, a module beside `banks.ts` and a line below.
 * `brandLogos.test.ts` fails on a name two entries share, a missing source or a large file.
 */
export const BRAND_LOGOS: readonly BrandLogoEntry[] = [...BANK_LOGOS, ...BROKER_LOGOS]

/** "Activo Bank", "ActivoBank" and "activobank" are one key: no case, accents, spaces or punctuation. */
export function normaliseBrandName(name: string): string {
	return name
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "")
}

const BY_NAME = new Map<string, BrandLogoEntry>()
for (const entry of BRAND_LOGOS) {
	for (const name of [entry.name, ...(entry.aliases ?? [])]) {
		const key = normaliseBrandName(name)
		if (!BY_NAME.has(key)) BY_NAME.set(key, entry)
	}
}

export function findBrandLogo(name: string): BrandLogoEntry | null {
	const key = normaliseBrandName(name)
	return key === "" ? null : (BY_NAME.get(key) ?? null)
}

/** Initials for a brand without a logo: two words' first letters, or one word's first two. */
export function brandMonogram(name: string): string {
	const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean)
	if (words.length === 0) return "?"
	const initials = words.length > 1 ? [...words[0]][0] + [...words[1]][0] : [...words[0]].slice(0, 2).join("")
	return initials.toUpperCase()
}

/** An image import is metadata in Astro and a plain URL under Vitest. */
export function logoSrc(logo: BrandLogoEntry["logo"]): string {
	return typeof logo === "string" ? logo : logo.src
}

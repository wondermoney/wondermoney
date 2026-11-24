import degiro from "@/assets/brands/brokers/degiro.webp"
import interactiveBrokers from "@/assets/brands/brokers/interactive-brokers.webp"
import type { BrandLogoEntry } from "./types"

/**
 * Brokers the product imports portfolio files from (the two in `InstitutionMarks.tsx`). Each tile
 * is the broker's own touch or home-screen icon, downloaded on 2026-11-23 from the URL in
 * `source` and saved as a 72 px WebP on white; their wordmarks in `src/assets/institutions/` are
 * too wide to read at 24 px.
 */
export const BROKER_LOGOS: readonly BrandLogoEntry[] = [
	{ category: "brokers", name: "DEGIRO", logo: degiro, source: "https://www.degiro.pt/apple-touch-icon.png" },
	{
		category: "brokers",
		name: "Interactive Brokers",
		aliases: ["IBKR"],
		logo: interactiveBrokers,
		source: "https://www.interactivebrokers.ie/images/web/favicons/home-screen-icon-192x192.png",
	},
]

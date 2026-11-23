import alvesBandeira from "@/assets/brands/fuel/alves-bandeira.webp"
import auchan from "@/assets/brands/fuel/auchan.webp"
import bp from "@/assets/brands/fuel/bp.webp"
import intermarche from "@/assets/brands/fuel/intermarche.webp"
import leclerc from "@/assets/brands/fuel/leclerc.webp"
import moeve from "@/assets/brands/fuel/moeve.webp"
import ozEnergia from "@/assets/brands/fuel/oz-energia.webp"
import pingoDoce from "@/assets/brands/fuel/pingo-doce.webp"
import plenergy from "@/assets/brands/fuel/plenergy.webp"
import prio from "@/assets/brands/fuel/prio.webp"
import q8 from "@/assets/brands/fuel/q8.webp"
import shell from "@/assets/brands/fuel/shell.webp"
import type { BrandLogoEntry } from "./types"

/**
 * Fuel station brands on the fuel prices page, as DGEG writes them ("INTERMARCHÉ", "OZ Energia";
 * matching ignores case and accents). Each tile is the brand's own touch icon, favicon or header
 * mark, downloaded on 2026-11-23 from the URL in `source`, set on white and saved as a 72 px WebP.
 *
 * Not here: GALP and REPSOL, which also sell electricity, take their tiles from the electricity
 * category. CEPSA keeps the monogram: the brand became Moeve and its sites now redirect to
 * Moeve's, so no Cepsa mark is published any more. "Genérico" (DGEG's word for an unbranded
 * station) and the long tail of local brands keep the monogram too.
 */
export const FUEL_LOGOS: readonly BrandLogoEntry[] = [
	{ category: "fuel", name: "Alves Bandeira", logo: alvesBandeira, source: "https://www.alvesbandeira.pt/temas/gab/favicon/ab/apple-touch-icon.png" },
	{ category: "fuel", name: "Auchan", logo: auchan, source: "https://www.auchan.pt/on/demandware.static/Sites-AuchanPT-Site/-/default/dw9cc5dd15/images/favicons/favicon-192x192.png" },
	// The header mark of bp's Portuguese site: the helios with the lower-case "bp".
	{ category: "fuel", name: "BP", logo: bp, source: "https://www.bp.com/apps/settings/wcm/designs/refresh/bp/images/navigation/bp-logo.svg" },
	// The app icon intermarche.pt shows in its app banner; its favicon is 16 px.
	{ category: "fuel", name: "Intermarché", logo: intermarche, source: "https://intermarche.pt/images/logo-app.png" },
	{ category: "fuel", name: "Leclerc", aliases: ["E.Leclerc"], logo: leclerc, source: "https://e-leclerc.pt/wp-content/uploads/2026/11/cropped-LOGO-REDONDO-180x180.png" },
	{ category: "fuel", name: "Moeve", logo: moeve, source: "https://pt.moeveglobal.com/recursos_alt/images/favicon/apple-touch-icon.png" },
	{ category: "fuel", name: "OZ Energia", logo: ozEnergia, source: "https://www.ozenergia.pt/wp-content/uploads/2025/10/cropped-icon-oz-180x180.png" },
	{ category: "fuel", name: "Pingo Doce", logo: pingoDoce, source: "https://www.pingodoce.pt/on/demandware.static/Sites-pingo-doce-Site/-/default/dw19a12cf0/images/favicons/favicon-196x196.png" },
	{ category: "fuel", name: "Plenergy", logo: plenergy, source: "https://plenergy.pt/wp-content/uploads/2022/11/favicon.svg" },
	// The apple-touch-icon prio.pt links to, served from its CDN.
	{ category: "fuel", name: "PRIO", logo: prio, source: "https://1644979638.rsc.cdn77.org/icon-ios.png" },
	// Kuwait Petroleum's own site for the brand; q8.pt is a parked domain.
	{ category: "fuel", name: "Q8", logo: q8, source: "https://www.q8.com/content/dam/q8dotcom/icons/Q8_logo_pos.svg" },
	{ category: "fuel", name: "Shell", logo: shell, source: "https://www.shell.pt/etc.clientlibs/amidala/clientlibs/theme-base/resources/favicon/apple-touch-icon.png" },
]

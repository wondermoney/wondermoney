import alfaEnergia from "@/assets/brands/electricity/alfa-energia.webp"
import audax from "@/assets/brands/electricity/audax.webp"
import coopernico from "@/assets/brands/electricity/coopernico.webp"
import edp from "@/assets/brands/electricity/edp.webp"
import ezuEnergia from "@/assets/brands/electricity/ezu-energia.webp"
import galp from "@/assets/brands/electricity/galp.webp"
import goldenergy from "@/assets/brands/electricity/goldenergy.webp"
import jafplus from "@/assets/brands/electricity/jafplus.webp"
import logicaEnergy from "@/assets/brands/electricity/logica-energy.webp"
import luzboa from "@/assets/brands/electricity/luzboa.webp"
import luzigas from "@/assets/brands/electricity/luzigas.webp"
import meoEnergia from "@/assets/brands/electricity/meo-energia.webp"
import nabaliaEnergia from "@/assets/brands/electricity/nabalia-energia.webp"
import nossaEnergia from "@/assets/brands/electricity/nossa-energia.webp"
import oeneoEnergy from "@/assets/brands/electricity/oeneo-energy.webp"
import plenitude from "@/assets/brands/electricity/plenitude.webp"
import portulogos from "@/assets/brands/electricity/portulogos.webp"
import repsol from "@/assets/brands/electricity/repsol.webp"
import yesEnergy from "@/assets/brands/electricity/yes-energy.webp"
import type { BrandLogoEntry } from "./types"

/**
 * Suppliers on the electricity tariff comparator, by the brand names `electricitySuppliers.ts`
 * gives ERSE's supplier codes. Each tile is the supplier's own touch icon, favicon or header mark,
 * downloaded on 2026-11-23 from the URL in `source`, set on white and saved as a 72 px WebP.
 * Two keep the monogram (`electricity.test.ts` lists them): Endesa publishes only a wordmark and a
 * 16 px favicon, too small to read on the tile (as Easisave among the banks), and Iberdrola's sites
 * refuse automated requests and serve only a 16 px favicon.
 *
 * Galp and Repsol also sell fuel: their entries carry the brand's main mark and serve the fuel
 * tools too, so a fuel module reuses them rather than adding a second entry.
 */
export const ELECTRICITY_LOGOS: readonly BrandLogoEntry[] = [
	{ category: "electricity", name: "Alfa Energia", logo: alfaEnergia, source: "https://www.alfaenergia.pt/img/graphics/webapp/icon_192.png" },
	{ category: "electricity", name: "Audax", logo: audax, source: "https://www.audaxenergy.pt/wp-content/uploads/2026/03/cropped-AUDAX-ISOTIPO-COLOR-RGB-180x180.jpg" },
	// The sunflower from the header logo, without the name.
	{ category: "electricity", name: "Coopérnico", logo: coopernico, source: "https://www.coopernico.org/img/logo/logo-coopernico.svg" },
	// The largest frame (48 px) of the favicon: edp.pt publishes no larger square mark.
	{ category: "electricity", name: "EDP", logo: edp, source: "https://www.edp.pt/media/rrel3zrc/favicon.ico" },
	{ category: "electricity", name: "EZU Energia", logo: ezuEnergia, source: "https://www.ezu.pt/img/graphics/ezu-logo_250_250.png" },
	{ category: "electricity", name: "Galp", logo: galp, source: "https://casa.galp.pt/pt/casa/themes/custom/gpower/favicon.ico" },
	{ category: "electricity", name: "Goldenergy", logo: goldenergy, source: "https://assets.goldenergy.pt/img/favicon/apple-touch-icon.png" },
	{ category: "electricity", name: "JAFplus", logo: jafplus, source: "https://jafplus.pt/wp-content/uploads/2021/06/cropped-favicon-001-270x270.png" },
	{ category: "electricity", name: "Logica Energy", logo: logicaEnergy, source: "https://logicaenergy.pt/wp-content/uploads/2020/02/cropped-icon-270x270.png" },
	{ category: "electricity", name: "Luzboa", logo: luzboa, source: "https://www.luzboa.pt/android-chrome-512x512.png" },
	{ category: "electricity", name: "LuziGás", logo: luzigas, source: "https://www.luzigas.pt/wp-content/uploads/fbrfg/apple-touch-icon.png" },
	{ category: "electricity", name: "MEO Energia", logo: meoEnergia, source: "https://conteudos.meoenergia.pt/Style%20Library/meoenergia/resources/images/favicons/favicon-180x180.png" },
	{ category: "electricity", name: "Nabalia Energia", logo: nabaliaEnergia, source: "https://assets.nabaliaenergia.com/icon.png" },
	// The largest frame (48 px) of the favicon, the only square mark the site serves.
	{ category: "electricity", name: "Nossa Energia", logo: nossaEnergia, source: "https://www.nossaenergia.pt/favicon.ico" },
	// The touch icon www.oeneo-energy.com links to, served from its site builder's CDN.
	{ category: "electricity", name: "OENEO Energy", logo: oeneoEnergy, source: "https://static.wixstatic.com/media/25ed57_016911483ec04fed8b03bca6b390138a%7Emv2.png/v1/fill/w_180%2Ch_180%2Clg_1%2Cusm_0.66_1.00_0.01/25ed57_016911483ec04fed8b03bca6b390138a%7Emv2.png" },
	// Plenitude's site uses Eni's six-legged dog as its touch icon.
	{ category: "electricity", name: "Plenitude", logo: plenitude, source: "https://eniplenitude.pt/etc.clientlibs/plenitude-common/clientlibs/clientlib-site/resources/assets/apple-touch-icon-180x180.png" },
	{ category: "electricity", name: "Portulogos", logo: portulogos, source: "https://portulogos.pt/wp-content/uploads/fbrfg/apple-touch-icon.png" },
	// The flame from the header logo, without the name.
	{ category: "electricity", name: "Repsol", logo: repsol, source: "https://www.repsol.pt/content/dam/global/logotipos/repsol/logo-repsol.svg" },
	// The largest frame (48 px) of the favicon; the header logo is a wordmark.
	{ category: "electricity", name: "Yes Energy", logo: yesEnergy, source: "https://www.yesenergy.pt/favicon.ico" },
]

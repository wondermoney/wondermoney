import abanca from "@/assets/brands/banks/abanca.webp"
import activobank from "@/assets/brands/banks/activobank.webp"
import baiEuropa from "@/assets/brands/banks/bai-europa.webp"
import bancoBest from "@/assets/brands/banks/banco-best.webp"
import bancoCtt from "@/assets/brands/banks/banco-ctt.webp"
import bankinter from "@/assets/brands/banks/bankinter.webp"
import big from "@/assets/brands/banks/big.webp"
import bil from "@/assets/brands/banks/bil.webp"
import bisonBank from "@/assets/brands/banks/bison-bank.webp"
import bluorBank from "@/assets/brands/banks/bluor-bank.webp"
import bniEuropa from "@/assets/brands/banks/bni-europa.webp"
import bpi from "@/assets/brands/banks/bpi.webp"
import bunq from "@/assets/brands/banks/bunq.webp"
import carregosa from "@/assets/brands/banks/carregosa.webp"
import cgd from "@/assets/brands/banks/cgd.webp"
import finantia from "@/assets/brands/banks/finantia.webp"
import haitongBank from "@/assets/brands/banks/haitong-bank.webp"
import klarna from "@/assets/brands/banks/klarna.webp"
import medirect from "@/assets/brands/banks/medirect.webp"
import moey from "@/assets/brands/banks/moey.webp"
import n26 from "@/assets/brands/banks/n26.webp"
import novobanco from "@/assets/brands/banks/novobanco.webp"
import openbank from "@/assets/brands/banks/openbank.webp"
import revolut from "@/assets/brands/banks/revolut.webp"
import tradeRepublic from "@/assets/brands/banks/trade-republic.webp"
import type { BrandLogoEntry } from "./types"

/**
 * Banks on the free bank accounts and term deposit pages. Each tile is the bank's own touch icon,
 * favicon or header mark, downloaded on 2026-11-23 from the URL in `source`, set on white and
 * saved as a 72 px WebP. Easisave has no square mark (only a wordmark and a 16 px favicon), so it
 * keeps the monogram.
 */
export const BANK_LOGOS: readonly BrandLogoEntry[] = [
	{ category: "banks", name: "ABANCA", logo: abanca, source: "https://abancaportugal.abanca.io/apple-touch-icon-152x152-precomposed.png" },
	{ category: "banks", name: "ActivoBank", logo: activobank, source: "https://www.activobank.pt/pt/PublishingImages/Favicons/favicon-180.png" },
	{ category: "banks", name: "BAI Europa", aliases: ["Banco BAI Europa"], logo: baiEuropa, source: "https://www.bancobaieuropa.pt/img/favicon/apple-touch-icon.png" },
	{ category: "banks", name: "Banco CTT", logo: bancoCtt, source: "https://www.bancoctt.pt/application/themes/images/icons/apple-touch-icon-180x180.png" },
	{ category: "banks", name: "Bankinter", logo: bankinter, source: "https://www.bankinter.pt/bankinterportugal-theme/images/bankinter/logo-header-compressed.svg" },
	{ category: "banks", name: "Best", aliases: ["Banco Best"], logo: bancoBest, source: "https://www.bancobest.pt/apple-touch-icon.png" },
	{ category: "banks", name: "BiG", aliases: ["Banco BiG"], logo: big, source: "https://www.big.pt/Resources/images/favicon-32x32.png" },
	{ category: "banks", name: "BIL", aliases: ["Banque Internationale à Luxembourg"], logo: bil, source: "https://www.bil.com/PublishingImages/favicon/apple-icon-180x180.png" },
	{ category: "banks", name: "Bison Bank", logo: bisonBank, source: "https://bisonbank.com/wp-content/uploads/2026/03/BB26_favicon-300x300.png" },
	{ category: "banks", name: "BluOr Bank", logo: bluorBank, source: "https://bluorbank.lv/favicons/favicon.svg" },
	{ category: "banks", name: "BNI Europa", aliases: ["Banco BNI Europa"], logo: bniEuropa, source: "https://bnieuropa.pt/wp-content/uploads/2024/06/cropped-cropped-cropped-Profile-Instuticional-3-180x180.png" },
	{ category: "banks", name: "BPI", aliases: ["Banco BPI"], logo: bpi, source: "https://www.bancobpi.pt/SitePublico_SiteBancoBPI/img/appletouchicon.png" },
	// The favicon www.bunq.com links to, served from its site builder's CDN.
	{ category: "banks", name: "bunq", logo: bunq, source: "https://framerusercontent.com/images/ziGDZruFQDclo0tQlc6TKONVk.png" },
	// The symbol from the header logo, without the "1833" under it, as in the bank's own favicon.
	{ category: "banks", name: "Carregosa", aliases: ["Banco Carregosa"], logo: carregosa, source: "https://www.bancocarregosa.com/temas/carregosa/img/logo_mancha.svg" },
	// The symbol the homepage already shows (src/assets/institutions/cgd.png), from cgd.pt.
	{ category: "banks", name: "CGD", aliases: ["Caixa Geral de Depósitos"], logo: cgd, source: "https://www.cgd.pt/PublishingImages/WSImages/Novo-CGD/favicon.ico.png" },
	// The grey symbol from the header logo, without the name.
	{ category: "banks", name: "Finantia", aliases: ["Banco Finantia"], logo: finantia, source: "https://www.finantia.com/wp-content/uploads/2025/10/SVG_Logo_BancoFinantia_01.svg" },
	{ category: "banks", name: "Haitong Bank", logo: haitongBank, source: "https://www.haitongib.com/media/3ysgypfy/favicon.png" },
	{ category: "banks", name: "Klarna", logo: klarna, source: "https://owp.klarna.com/public/klarna/appIcon.png" },
	{ category: "banks", name: "MeDirect", logo: medirect, source: "https://www.medirect.com.mt/wp-content/uploads/cropped-Me-Logo-Black2-180x180.png" },
	{ category: "banks", name: "moey!", logo: moey, source: "https://moey.pt/hubfs/android-chrome-512x512.png" },
	{ category: "banks", name: "N26", logo: n26, source: "https://n26.com/_build/logo-256x256.png" },
	{ category: "banks", name: "novobanco", logo: novobanco, source: "https://www.novobanco.pt/etc.clientlibs/novobancopublicsites/clientlibs/clientlib-resources/resources/apple-touch-icon-180x180.png" },
	{ category: "banks", name: "Openbank", logo: openbank, source: "https://www.openbank.pt/favicon.ico" },
	{ category: "banks", name: "Revolut", logo: revolut, source: "https://assets.revolut.com/assets/favicons/apple-touch-icon.png" },
	{ category: "banks", name: "Trade Republic", logo: tradeRepublic, source: "https://traderepublic.com/favicon.ico" },
]

import apple from "@/assets/brands/securities/apple.webp"
import microsoft from "@/assets/brands/securities/microsoft.webp"
import vanguard from "@/assets/brands/securities/vanguard.webp"
import type { BrandLogoEntry } from "./types"

/**
 * Issuers of the sample holdings in the portfolio preview, matched by ticker. Downloaded on
 * 2026-11-24 from the URL in `source` and saved as a 72 px WebP on white: Apple's touch icon with
 * its grey background whitened, Microsoft's largest favicon frame, and Vanguard's vector "V" from
 * its corporate site, drawn in the red of its favicon without the registered-trademark sign.
 */
export const SECURITY_LOGOS: readonly BrandLogoEntry[] = [
	{ category: "securities", name: "Apple", aliases: ["AAPL", "Apple Inc."], logo: apple, source: "https://www.apple.com/apple-touch-icon.png" },
	{ category: "securities", name: "Microsoft", aliases: ["MSFT"], logo: microsoft, source: "https://learn.microsoft.com/favicon.ico" },
	{
		category: "securities",
		name: "Vanguard",
		aliases: ["VWCE"],
		logo: vanguard,
		source: "https://corporate.vanguard.com/etc.clientlibs/corporatesite/clientlibs/clientlib-site/resources/icons/vanguardLogos/VGVMWhite.svg",
	},
]

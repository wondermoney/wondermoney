/**
 * The data-snapshot tool pages: each shows dated figures from one source, which the page
 * describes as a schema.org Dataset (`buildToolStructuredData` in structuredData.ts) and the
 * sitemap dates with `lastmod`. Kept apart from structuredData.ts so astro.config.mjs can read it
 * without the translations and icons. The electricity offers module is large and must only be
 * imported dynamically (`electricityOffersScript.test.ts`), so the table is loaded once, async.
 */
import { BANK_ACCOUNTS_SOURCE } from "./calculators/data/bankAccountsSource"
import { EURIBOR_SOURCE } from "./calculators/data/euribor"
import { FUEL_PRICES_SOURCE } from "./calculators/data/fuelPrices"
import { FUEL_STATIONS_SOURCE } from "./calculators/data/fuelStations"
import { TERM_DEPOSIT_OFFERS_AS_OF } from "./calculators/data/termDepositOffers"
import { SUPPORTED_LANGS } from "./i18nLocale"
import { toLocalizedPath, type ToolRouteId } from "./routes"

/** WonderMoney, as the creator of the tables it compiles itself. */
const WONDERMONEY = {
	"@type": "Organization",
	"@id": "https://wonder.money/#organization",
	name: "WonderMoney",
	url: "https://wonder.money",
}

export interface DatasetSource {
	/** The date the page gives for its data, YYYY-MM-DD. */
	readonly dateModified: string
	/** Who produced the figures, as the page's source line names them. */
	readonly creator: Record<string, unknown>
	/** The source the page links, when it links one. */
	readonly isBasedOn?: string
	/** ISO 8601 interval of the figures, when the page gives it. */
	readonly temporalCoverage?: string
}

function laterDate(a: string, b: string): string {
	return a > b ? a : b
}

/** The data-snapshot tools, which `loadToolDatasets` describes. */
export const DATASET_TOOL_ROUTE_IDS = [
	"toolFuelPrices",
	"toolElectricityTariffComparison",
	"toolTermDepositOffers",
	"toolFreeBankAccounts",
	"toolEuribor",
] as const satisfies readonly ToolRouteId[]

export type DatasetToolRouteId = (typeof DATASET_TOOL_ROUTE_IDS)[number]

let datasets: Promise<Record<DatasetToolRouteId, DatasetSource>> | undefined

/**
 * The data-snapshot tools: each page shows dated figures from one source, so it also describes
 * them as a Dataset. Licences are left out: none of these sources states one on the page.
 */
export function loadToolDatasets(): Promise<Record<DatasetToolRouteId, DatasetSource>> {
	datasets ??= buildToolDatasets()
	return datasets
}

async function buildToolDatasets(): Promise<Record<DatasetToolRouteId, DatasetSource>> {
	const { ELECTRICITY_OFFERS_SOURCE } = await import("./calculators/data/electricityOffers")

	return {
		toolFuelPrices: {
			// The national averages and the cheapest stations; the page shows both dates.
			dateModified: laterDate(FUEL_PRICES_SOURCE.asOf, FUEL_STATIONS_SOURCE.asOf),
			creator: {
				"@type": "Organization",
				name: "Direção-Geral de Energia e Geologia",
				alternateName: "DGEG",
				url: "https://www.dgeg.gov.pt",
			},
			isBasedOn: FUEL_PRICES_SOURCE.url,
			temporalCoverage: `${FUEL_PRICES_SOURCE.firstDate}/${FUEL_PRICES_SOURCE.asOf}`,
		},
		toolElectricityTariffComparison: {
			dateModified: ELECTRICITY_OFFERS_SOURCE.exportedOn,
			creator: {
				"@type": "Organization",
				name: "Entidade Reguladora dos Serviços Energéticos",
				alternateName: "ERSE",
				url: "https://www.erse.pt",
			},
			isBasedOn: ELECTRICITY_OFFERS_SOURCE.url,
		},
		toolTermDepositOffers: {
			// "Conditions compiled by WonderMoney from the banks' published offers".
			dateModified: TERM_DEPOSIT_OFFERS_AS_OF,
			creator: WONDERMONEY,
		},
		toolFreeBankAccounts: {
			dateModified: BANK_ACCOUNTS_SOURCE.asOf,
			creator: WONDERMONEY,
		},
		toolEuribor: {
			dateModified: EURIBOR_SOURCE.fetchedOn,
			creator: {
				"@type": "Organization",
				name: "Banco de Portugal",
				url: "https://www.bportugal.pt",
			},
			isBasedOn: EURIBOR_SOURCE.url,
			temporalCoverage: `${EURIBOR_SOURCE.firstMonth}/${EURIBOR_SOURCE.lastMonth}`,
		},
	}
}

/**
 * The sitemap's `lastmod` of a page: the data date of a data-snapshot tool page, in any locale,
 * from the table `loadToolDatasets` gave. Other pages carry none rather than a build date that
 * would change every deploy.
 */
export function toolDataLastmod(
	pathname: string,
	sources: Record<DatasetToolRouteId, DatasetSource>,
): string | undefined {
	const normalized = pathname.replace(/\/+$/, "")
	for (const routeId of DATASET_TOOL_ROUTE_IDS) {
		for (const locale of SUPPORTED_LANGS) {
			if (toLocalizedPath(routeId, locale) === normalized) return sources[routeId].dateModified
		}
	}
	return undefined
}

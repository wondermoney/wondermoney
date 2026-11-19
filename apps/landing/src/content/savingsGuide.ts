import type { RouteId } from "@/lib/routes";

/**
 * Content of the "where to keep your savings in Portugal" guide: the comparison table the
 * maintainer supplied, transcribed here once, plus the official sources behind it. The wording
 * lives in the locale catalogues under `savingsGuide.*`; this module holds the structure, so
 * the table's merged cells are kept as spans and every locale shows the same table.
 */

export const SAVINGS_PRODUCT_IDS = [
	"aforro",
	"tesouro",
	"demand",
	"savings",
	"term",
	"capitalisation",
	"ppr",
] as const

export type SavingsProductId = (typeof SAVINGS_PRODUCT_IDS)[number]

export const SAVINGS_COLUMN_IDS = ["guarantee", "topUp", "withdrawal", "interest", "irs"] as const

export type SavingsColumnId = (typeof SAVINGS_COLUMN_IDS)[number]

/** One cell of the table. It applies to every product in `products`, which are consecutive rows. */
export type SavingsCell = {
	readonly products: readonly SavingsProductId[]
	/** Translation keys under `savingsGuide.cells`, shown one per line. */
	readonly parts: readonly string[]
}

const cell = (products: readonly SavingsProductId[], ...parts: string[]): SavingsCell => ({ products, parts })

export const SAVINGS_TABLE: Readonly<Record<SavingsColumnId, readonly SavingsCell[]>> = {
	guarantee: [
		cell(["aforro", "tesouro"], "state", "noLimit"),
		cell(["demand", "savings", "term"], "fgd", "fgdLimit"),
		cell(["capitalisation", "ppr"], "insurer", "noLimit"),
	],
	topUp: [
		cell(["aforro", "tesouro"], "certificatesTopUp"),
		cell(["demand"], "demandTopUp"),
		cell(["savings"], "savingsTopUp"),
		cell(["term"], "notAllowed"),
		cell(["capitalisation", "ppr"], "insuranceTopUp"),
	],
	withdrawal: [
		cell(["aforro"], "aforroWithdrawal"),
		cell(["tesouro"], "tesouroWithdrawal"),
		cell(["demand"], "demandWithdrawal"),
		cell(["savings"], "savingsWithdrawal"),
		cell(["term"], "termWithdrawal"),
		cell(["capitalisation"], "capitalisationWithdrawal"),
		cell(["ppr"], "pprWithdrawal"),
	],
	interest: [
		cell(["aforro"], "quarterly", "creditedBalanceNet"),
		cell(["tesouro"], "yearly", "paidAccountNet"),
		cell(["demand"], "frequencyVaries", "creditedBalanceDomesticNet"),
		cell(["savings"], "frequencyVaries", "creditedBalanceOrAccountDomesticNet"),
		cell(["term"], "paidAtTermEnd", "creditedAccountDomesticNet"),
		cell(["capitalisation", "ppr"], "frequencyVaries", "creditedBalanceGross"),
	],
	irs: [
		cell(["aforro", "tesouro"], "irsAtPayment", "rate28"),
		cell(
			["demand", "savings", "term"],
			"domesticBanks",
			"irsAtPayment",
			"rate28",
			"foreignBanks",
			"irsInReturn",
			"rate28",
		),
		cell(["capitalisation"], "irsOnWithdrawal", "capitalisationRates"),
		cell(["ppr"], "irsOnWithdrawal", "pprRates", "pprLegalRate"),
	],
}

/** The cells that start on a product's row, with the number of rows they span. */
export function getTableRowCells(productId: SavingsProductId) {
	return SAVINGS_COLUMN_IDS.flatMap((column) =>
		SAVINGS_TABLE[column]
			.filter((entry) => entry.products[0] === productId)
			.map((entry) => ({ column, rowSpan: entry.products.length, parts: entry.parts })),
	)
}

/** Every cell that applies to a product, merged cells included (for the stacked layout). */
export function getProductCells(productId: SavingsProductId) {
	return SAVINGS_COLUMN_IDS.map((column) => {
		const entry = SAVINGS_TABLE[column].find((candidate) => candidate.products.includes(productId))
		if (!entry) throw new Error(`No ${column} cell for ${productId}`)
		return { column, parts: entry.parts }
	})
}

/** The day the facts below were last checked against the sources. Passed to formatMonthYear. */
export const SAVINGS_GUIDE_CHECKED_ON = "2026-11-19"

export const SAVINGS_SOURCE_IDS = [
	"fgd",
	"aforro",
	"tesouro",
	"tesouroRedemption",
	"cirs71",
	"cirs72",
	"cirs5",
	"ebf21",
] as const

export type SavingsSourceId = (typeof SAVINGS_SOURCE_IDS)[number]

/** Official sources: the guarantee, certificate and tax statements on the page rest on these. */
export const SAVINGS_SOURCES: Readonly<Record<SavingsSourceId, { readonly url: string }>> = {
	fgd: { url: "https://www.fgd.pt/en/deposit-guarantee" },
	aforro: { url: "https://www.igcp.pt/" },
	tesouro: {
		url: "https://www.gov.pt/noticias/igcp-lanca-novos-certificados-do-tesouro-serie-5-disponiveis-nos-espacos-cidadao",
	},
	tesouroRedemption: { url: "https://www.gov.pt/servicos/resgatar-certificados-do-tesouro" },
	cirs71: { url: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs71.aspx" },
	cirs72: { url: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs72.aspx" },
	cirs5: { url: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs5.aspx" },
	ebf21: { url: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/bf/Pages/bf-artigo-21-ordm-.aspx" },
}

/**
 * Calculators and comparators the guide links to. The page renders this list in order, so
 * a comparator route can be appended once it exists on develop.
 */
export const SAVINGS_GUIDE_RELATED_ROUTE_IDS = [
	"toolSavingsCertificates",
	"toolDepositRateIndex",
	"toolTermDeposit",
	"toolTermDepositOffers",
] as const satisfies ReadonlyArray<RouteId>

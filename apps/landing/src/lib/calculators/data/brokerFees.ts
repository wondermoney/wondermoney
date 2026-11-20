/**
 * Broker fees for investors resident in Portugal, read from each broker's own published price
 * list (tarifário, preçário or fee page) on the date in `checked`. No comparison site or blog is
 * a source. A fee the broker does not publish is `null` ("not published") and never guessed.
 *
 * Upkeep: re-check every row each quarter (first week of January, April, July and October)
 * against the URLs in `sources`, update the figures and each row's `checked`, then bump
 * `BROKER_FEES_REVIEWED`. The page shows the review date and warns when it is older than about
 * four months (`BROKER_FEES_STALE_AFTER_DAYS` in ../brokerFees.ts).
 */

export const BROKER_FEES_REVIEWED = "2026-11-20"

/** Inputs the scenarios assume, shown on the page. */
export const BROKER_FEES_ASSUMPTIONS = {
	/** US dollars per euro, to convert USD fees and orders: the ECB reference rate of `eurUsdDate`. */
	eurUsd: 1.0992,
	eurUsdDate: "2026-11-19",
	/** Price of one US share in dollars, to count shares for per-share fees. */
	sharePrice: 100,
} as const

/** One band of a tiered commission: applies to orders up to `upTo` (in the fee's currency). */
export interface FeeTier {
	/** Upper bound of the band, inclusive; null for the last band. */
	upTo: number | null
	fixed: number
	pct: number
}

/** The commission on one buy order, as the broker publishes it. */
export interface OrderFee {
	currency: "EUR" | "USD"
	/** Fixed part per order, handling fees included. */
	fixed: number
	/** Percentage of the order value. */
	pct: number
	/** Per share, in `currency`. */
	perShare: number
	/** Minimum per order, in `currency`; 0 when there is none. */
	min: number
	/** Maximum per order, in `currency`; null when there is none. */
	max: number | null
	/** Maximum as a percentage of the order value; null when there is none. */
	maxPctOfValue: number | null
	/** Monthly turnover in euros free of commission; null when there is no allowance. */
	freeMonthlyTurnover: number | null
	/** Orders each month free of commission (ActivoBank's first order of the month); 0 for none. */
	freeOrdersPerMonth: number
	/** Bands by order value that replace `fixed` and `pct`; null when the fee is not tiered. */
	tiers: readonly FeeTier[] | null
}

/** Custody or account maintenance fee, per period, on the value held. */
export interface CustodyFee {
	period: "month" | "quarter" | "semester" | "year"
	/** Percentage of the value held, per period. */
	pct: number
	/** Fixed amount in euros per period. */
	fixed: number
	/** Minimum per period, in euros; 0 when there is none. */
	min: number
	/** Maximum per period, in euros; null when there is none. */
	max: number | null
	/** Value held free of the fee: the percentage applies only above it (0 for none). */
	exemptValue: number
}

export type CashInterest =
	/** `pct` a year on the euro balance above `aboveBalance` (0 for all of it), up to `maxBalance`. */
	| { kind: "rate"; pct: number; aboveBalance: number; maxBalance: number | null }
	| { kind: "none" }

/** Compensation and guarantee schemes; each has its name under `tools.brokerFees.schemes`. */
export type SchemeId =
	| "ptSii"
	| "ptFgd"
	| "deInvestor"
	| "deEdw"
	| "deDeposit"
	| "ieIcs"
	| "plKdpw"
	| "eeFund"

export interface Protection {
	scheme: SchemeId
	/** Maximum compensation per client, in euros. */
	amount: number
	/** Share of the loss the scheme pays, up to `amount`; 100 when it pays all of it. */
	coveragePct: number
	url: string
}

/**
 * A yearly fee for each exchange used, such as DEGIRO's connectivity fee, capped at a share of the
 * value held. It applies to the markets listed.
 */
export interface MarketFee {
	perYear: number
	maxPctOfPortfolio: number | null
	markets: readonly ("etfEu" | "usStock")[]
}

export type FeeKind = "trading" | "fx" | "custody"

export interface FeeTax {
	kind: "stampDuty" | "vat"
	pct: number
	on: readonly FeeKind[]
}

export interface Broker {
	id: string
	name: string
	/** The legal entity that serves Portuguese residents. */
	entity: string
	/** ISO 3166 code of the entity's home country. */
	country: string
	regulator: string
	/** Exchange the EU ETF fee applies to. */
	etfVenue: string | null
	etfEu: OrderFee | null
	/** Recurring ETF savings plan; null when there is none or it is not published. */
	etfSavingsPlan: OrderFee | null
	usStock: OrderFee | null
	/** Currency conversion fee, percent of the amount converted. */
	fxPct: number | null
	custody: CustodyFee | null
	/** Yearly per-exchange fee on top of custody; null when the broker has none. */
	marketFee: MarketFee | null
	/** Interest on uninvested cash in euros; null when not published. */
	cashInterest: CashInterest | null
	investorProtection: Protection | null
	/** Deposit guarantee on cash held at a bank, where the broker states one. */
	depositGuarantee: Protection | null
	/** "yes": provides Portuguese tax reporting or withholds; "no": the investor declares it; null: not stated. */
	ptTaxReport: "yes" | "no" | null
	/** Taxes the price list adds on top of its fees: Portuguese stamp duty, VAT. */
	feeTaxes: readonly FeeTax[]
	/** Has a short note under `tools.brokerFees.brokerNotes.<id>` in every locale. */
	note: boolean
	sources: readonly { label: string; url: string }[]
	/** The day the sources were read. */
	checked: string
}

const ORDER: OrderFee = {
	currency: "EUR",
	fixed: 0,
	pct: 0,
	perShare: 0,
	min: 0,
	max: null,
	maxPctOfValue: null,
	freeMonthlyTurnover: null,
	freeOrdersPerMonth: 0,
	tiers: null,
}

const order = (fee: Partial<OrderFee>): OrderFee => ({ ...ORDER, ...fee })

const NO_CUSTODY: CustodyFee = { period: "year", pct: 0, fixed: 0, min: 0, max: null, exemptValue: 0 }

const CHECKED = "2026-11-20"

/** Portuguese stamp duty (Imposto do Selo) on brokerage commissions, where a price list adds it. */
const PT_STAMP_DUTY = 4
/** Portuguese standard VAT (mainland rate), where a price list adds "IVA à taxa em vigor". */
const PT_VAT = 23
/** Portuguese banks: stamp duty on order commissions, VAT on custody. */
const PT_BANK_TAXES: readonly FeeTax[] = [
	{ kind: "stampDuty", pct: PT_STAMP_DUTY, on: ["trading"] },
	{ kind: "vat", pct: PT_VAT, on: ["custody"] },
]

/** Portuguese investor compensation (Decreto-Lei 222/99, art. 10.º): up to €25,000. */
const PT_SII: Protection = {
	scheme: "ptSii",
	amount: 25_000,
	coveragePct: 100,
	url: "https://diariodarepublica.pt/dr/legislacao-consolidada/decreto-lei/1999-34488075",
}

/** Portuguese deposit guarantee on cash: up to €100,000 per depositor and bank. */
const PT_FGD: Protection = { scheme: "ptFgd", amount: 100_000, coveragePct: 100, url: "https://www.fgd.pt/montantes-garantidos" }

export const BROKER_FEES: readonly Broker[] = [
	{
		// Precario.pdf "Atualizado a 29 de outubro de 2026". The EU ETF fee is the Tradegate "Seleção
		// de ETFs" (€0 + €1 handling, no connectivity fee); other exchanges are in the note. US orders
		// are €1 + €1 handling, plus the €2.50 yearly connectivity fee per exchange (p.10).
		id: "degiro",
		name: "DEGIRO",
		entity: "flatexDEGIRO Bank SE, Dutch Branch",
		country: "DE",
		regulator: "BaFin, DNB, AFM",
		etfVenue: "Tradegate",
		etfEu: order({ fixed: 1 }),
		etfSavingsPlan: null,
		usStock: order({ fixed: 2 }),
		fxPct: 0.25,
		custody: NO_CUSTODY,
		marketFee: { perYear: 2.5, maxPctOfPortfolio: 0.25, markets: ["usStock"] },
		cashInterest: { kind: "none" },
		investorProtection: { scheme: "deInvestor", amount: 20_000, coveragePct: 90, url: "https://www.degiro.pt/sobre-a-degiro/robusta-e-de-confianca" },
		depositGuarantee: { scheme: "deDeposit", amount: 100_000, coveragePct: 100, url: "https://www.degiro.pt/sobre-a-degiro/robusta-e-de-confianca" },
		ptTaxReport: null,
		feeTaxes: [],
		note: true,
		sources: [
			{ label: "Preçário (PDF)", url: "https://www.degiro.pt/data/pdf/pt/Precario.pdf" },
			{ label: "Preçário", url: "https://www.degiro.pt/precario" },
			{ label: "Proteção do investidor", url: "https://www.degiro.pt/sobre-a-degiro/robusta-e-de-confianca" },
		],
		checked: CHECKED,
	},
	{
		// IBKR Pro Fixed pricing, Interactive Brokers Ireland (Portugal maps to interactivebrokers.ie).
		// EU ETF: Xetra 0.05%, min €3, no third-party fees. US: USD 0.005 a share, min USD 1, max 1%
		// of the trade. FX: the 0.03% auto-conversion mark-up. Cash: benchmark − 0.5% above €10,000.
		id: "ibkr",
		name: "Interactive Brokers",
		entity: "Interactive Brokers Ireland Limited",
		country: "IE",
		regulator: "Central Bank of Ireland",
		etfVenue: "Xetra",
		etfEu: order({ pct: 0.05, min: 3 }),
		etfSavingsPlan: null,
		usStock: order({ currency: "USD", perShare: 0.005, min: 1, maxPctOfValue: 1 }),
		fxPct: 0.03,
		custody: NO_CUSTODY,
		marketFee: null,
		cashInterest: { kind: "rate", pct: 1.967, aboveBalance: 10_000, maxBalance: null },
		investorProtection: { scheme: "ieIcs", amount: 20_000, coveragePct: 90, url: "https://www.interactivebrokers.ie/en/general/security-investor-protection.php" },
		depositGuarantee: null,
		ptTaxReport: null,
		feeTaxes: [],
		note: true,
		sources: [
			{ label: "Commissions: stocks, ETFs", url: "https://www.interactivebrokers.ie/en/pricing/commissions-stocks.php" },
			{ label: "Commissions: spot currencies", url: "https://www.interactivebrokers.ie/en/pricing/commissions-spot-currencies.php" },
			{ label: "Interest rates", url: "https://www.interactivebrokers.ie/en/accounts/fees/pricing-interest-rates.php" },
			{ label: "Investor protection", url: "https://www.interactivebrokers.ie/en/general/security-investor-protection.php" },
		],
		checked: CHECKED,
	},
	{
		// "Condições e comissões" (Invest): no commission, no custody fee, FX 0.15%, EUR interest 2.8%
		// TANB up to €100,000 for new Trading 212 EU clients. Invest Terms of 02.11.2026.
		id: "trading212",
		name: "Trading 212",
		entity: "Trading 212 EU GmbH",
		country: "DE",
		regulator: "BaFin",
		etfVenue: null,
		etfEu: order({}),
		etfSavingsPlan: order({}),
		usStock: order({}),
		fxPct: 0.15,
		custody: NO_CUSTODY,
		marketFee: null,
		cashInterest: { kind: "rate", pct: 2.8, aboveBalance: 0, maxBalance: 100_000 },
		investorProtection: { scheme: "deEdw", amount: 20_000, coveragePct: 90, url: "https://www.trading212.com/legal-documentation/t212-de/common/Investor-Guarantee-Scheme-FXFlat_PT.pdf" },
		depositGuarantee: { scheme: "deDeposit", amount: 100_000, coveragePct: 100, url: "https://www.trading212.com/legal-documentation/t212-de/common/Omnibus-Bank-Accounts_PT.pdf" },
		ptTaxReport: "no",
		feeTaxes: [],
		note: true,
		sources: [
			{ label: "Condições e comissões", url: "https://www.trading212.com/pt/terms/invest" },
			{ label: "Termos Invest (PDF)", url: "https://www.trading212.com/legal-documentation/t212-de/invest/Invest-Terms_PT.pdf" },
			{ label: "Sistema de indemnização (PDF)", url: "https://www.trading212.com/legal-documentation/t212-de/common/Investor-Guarantee-Scheme-FXFlat_PT.pdf" },
		],
		checked: CHECKED,
	},
	{
		// Tabela de custos e comissões of 20 October 2026: 0% up to €100,000 of monthly turnover, then
		// 0.2% (min €10) on the excess; FX 0.5%; custody 0.02% a year above €250,000; amounts include
		// stamp duty or VAT (p.10). Standard EUR interest 1.10% since 16.11.2026.
		id: "xtb",
		name: "XTB",
		entity: "XTB S.A. – Sucursal em Portugal",
		country: "PL",
		regulator: "KNF, CMVM",
		etfVenue: null,
		etfEu: order({ pct: 0.2, min: 10, freeMonthlyTurnover: 100_000 }),
		etfSavingsPlan: order({ pct: 0.2, min: 10, freeMonthlyTurnover: 100_000 }),
		usStock: order({ pct: 0.2, min: 10, freeMonthlyTurnover: 100_000 }),
		fxPct: 0.5,
		custody: { period: "year", pct: 0.02, fixed: 0, min: 0, max: null, exemptValue: 250_000 },
		marketFee: null,
		cashInterest: { kind: "rate", pct: 1.1, aboveBalance: 0, maxBalance: null },
		investorProtection: { scheme: "plKdpw", amount: 20_100, coveragePct: 90, url: "https://www.xtb.com/pt/conta-e-taxas" },
		depositGuarantee: null,
		ptTaxReport: "yes",
		feeTaxes: [],
		note: true,
		sources: [
			{ label: "Tabela de custos e comissões (PDF)", url: "https://www.xtb.com/pt/servicos/informacao-de-conta/custos-e-comissoes/commission.pdf" },
			{ label: "Juros", url: "https://www.xtb.com/pt/juros" },
			{ label: "Condições específicas em Portugal (PDF)", url: "https://xtb.com/pt/servicos/informacao-de-conta/informacao-legal/condicoes_especificas_servicos_prestados_em_portugal.pdf" },
		],
		checked: CHECKED,
	},
	{
		// Preços and "Comissões e impostos": ETFs free, US shares 0.10% (USD 0.10 to USD 1), FX 0.35%
		// with 4% Portuguese stamp duty on the conversion fee; no custody fee. Terms of 13 May 2026.
		id: "lightyear",
		name: "Lightyear",
		entity: "Lightyear Europe AS",
		country: "EE",
		regulator: "Finantsinspektsioon",
		etfVenue: null,
		etfEu: order({}),
		etfSavingsPlan: order({}),
		usStock: order({ currency: "USD", pct: 0.1, min: 0.1, max: 1 }),
		fxPct: 0.35,
		custody: NO_CUSTODY,
		marketFee: null,
		cashInterest: null,
		investorProtection: { scheme: "eeFund", amount: 20_000, coveragePct: 100, url: "https://lightyear.com/cms/20260513_LIGHTYEAR_TERMS_OF_SERVICE_PT_8ddf5d8139.pdf" },
		depositGuarantee: null,
		ptTaxReport: "no",
		feeTaxes: [{ kind: "stampDuty", pct: PT_STAMP_DUTY, on: ["fx"] }],
		note: true,
		sources: [
			{ label: "Preços", url: "https://lightyear.com/pt-pt/pricing" },
			{ label: "Comissões e impostos", url: "https://lightyear.com/pt-pt/help/deposits-conversions-and-withdrawals/fees-and-taxes" },
			{ label: "Termos de serviço (PDF)", url: "https://lightyear.com/cms/20260513_LIGHTYEAR_TERMS_OF_SERVICE_PT_8ddf5d8139.pdf" },
		],
		checked: CHECKED,
	},
	{
		// "Sistema de preços": no commission, €1 settlement fee per order, savings plans free, no
		// custody fee. No separate FX fee is published (conversion is part of the price), and no
		// investor-compensation amount for securities is stated. Interest: 4% TANB promotion for new
		// clients up to €20,000 until 01/03/2027 (standard rate not published).
		id: "trade-republic",
		name: "Trade Republic",
		entity: "Trade Republic Bank GmbH, Sucursal em Portugal",
		country: "DE",
		regulator: "BaFin, Banco de Portugal",
		etfVenue: null,
		etfEu: order({ fixed: 1 }),
		etfSavingsPlan: order({}),
		usStock: order({ fixed: 1 }),
		fxPct: null,
		custody: NO_CUSTODY,
		marketFee: null,
		cashInterest: { kind: "rate", pct: 4, aboveBalance: 0, maxBalance: 20_000 },
		investorProtection: null,
		depositGuarantee: { scheme: "deDeposit", amount: 100_000, coveragePct: 100, url: "https://assets.traderepublic.com/assets/files/TradeRepublic_DepositorInformationSheet.pdf" },
		ptTaxReport: "yes",
		feeTaxes: [],
		note: true,
		sources: [
			{ label: "Sistema de preços", url: "https://traderepublic.com/pt-pt?openModal=pricing-scheme" },
			{ label: "Juros", url: "https://traderepublic.com/pt-pt/juros" },
			{ label: "Customer Agreement (PDF)", url: "https://assets.traderepublic.com/assets/files/CA_PT-en.pdf" },
		],
		checked: CHECKED,
	},
	{
		// Preçário de Títulos PC9072 of 20 August 2026, online orders. The first order of each month
		// (website or app, per current account, any market) is free; then €5 (Euronext) or USD 5 (US),
		// plus 4% stamp duty. "Comissão de Serviço de Bolsa" €3 a month + VAT, "integrados (Nacionais
		// e Internacionais)"; note (5) of the same page puts foreign securities under the "não
		// integrados" custody tiers, which the note on the page flags. FX at internal rates, no spread
		// published.
		id: "activobank",
		name: "ActivoBank",
		entity: "Banco ActivoBank, S.A.",
		country: "PT",
		regulator: "Banco de Portugal, CMVM",
		etfVenue: "Euronext Amsterdam",
		etfEu: order({ fixed: 5, freeOrdersPerMonth: 1 }),
		etfSavingsPlan: null,
		usStock: order({ currency: "USD", fixed: 5, freeOrdersPerMonth: 1 }),
		fxPct: null,
		custody: { period: "month", pct: 0, fixed: 3, min: 0, max: null, exemptValue: 0 },
		marketFee: null,
		cashInterest: { kind: "none" },
		investorProtection: PT_SII,
		depositGuarantee: PT_FGD,
		ptTaxReport: "yes",
		feeTaxes: PT_BANK_TAXES,
		note: true,
		sources: [
			{
				label: "Preçário de Títulos (PDF)",
				url: "https://www.activobank.pt/_layouts/15/Services/DocumentHandler.ashx?doctype=DOCREF&ref=PC9072&lang=PT",
			},
			{ label: "Fiscalidade dos ETF", url: "https://www.activobank.pt/pt/investimentos/Pages/fiscalidade/etf.aspx" },
		],
		checked: CHECKED,
	},
	{
		// Preçário de títulos, in force from 12 November 2026: Best's standard service, internet and
		// app. 0.25% (min €12) for the first 20 orders of the month, 0.10%
		// (min €12) after; stamp duty 4%. Custody €6 a quarter + VAT per dossier with securities.
		// FX: 0.5% on the indicative rate. The Best Trading Pro service has its own prices (note).
		id: "banco-best",
		name: "Banco Best",
		entity: "BEST – Banco Electrónico de Serviço Total, S.A.",
		country: "PT",
		regulator: "Banco de Portugal, CMVM",
		etfVenue: null,
		etfEu: order({ pct: 0.25, min: 12 }),
		etfSavingsPlan: null,
		usStock: order({ pct: 0.25, min: 12 }),
		fxPct: 0.5,
		custody: { period: "quarter", pct: 0, fixed: 6, min: 0, max: null, exemptValue: 0 },
		marketFee: null,
		cashInterest: { kind: "none" },
		investorProtection: PT_SII,
		depositGuarantee: PT_FGD,
		ptTaxReport: null,
		feeTaxes: PT_BANK_TAXES,
		note: true,
		sources: [
			{ label: "Preçário de títulos (PDF)", url: "https://www.bancobest.pt/bestsite/best_docs/PRE_PRF_titulos.pdf" },
			{
				label: "Taxas de juro, contas de depósito (PDF)",
				url: "https://www.bancobest.pt/bestsite/best_docs/PRE_FTJ_17_contas_deposito_particulares.pdf",
			},
		],
		checked: CHECKED,
	},
	{
		// Preçário BIG018b, section 21 "Valores Mobiliários" of 28 July 2026, online orders: Euronext
		// €11.95 up to €12,000, 0.10% up to €250,000, 0.09% above; US USD 14.95 up to USD 12,500, 0.12%
		// up to USD 250,000, 0.09% above; stamp duty 4% on brokerage. Custody €6 a quarter + VAT (waived
		// on some conditions, note). FX spread indicatively 0.50%. Conta Global pays 0.00%.
		id: "big",
		name: "Banco BiG",
		entity: "Banco de Investimento Global, S.A.",
		country: "PT",
		regulator: "Banco de Portugal, CMVM",
		etfVenue: "Euronext Amsterdam",
		etfEu: order({
			tiers: [
				{ upTo: 12_000, fixed: 11.95, pct: 0 },
				{ upTo: 250_000, fixed: 0, pct: 0.1 },
				{ upTo: null, fixed: 0, pct: 0.09 },
			],
		}),
		etfSavingsPlan: null,
		usStock: order({
			currency: "USD",
			tiers: [
				{ upTo: 12_500, fixed: 14.95, pct: 0 },
				{ upTo: 250_000, fixed: 0, pct: 0.12 },
				{ upTo: null, fixed: 0, pct: 0.09 },
			],
		}),
		fxPct: 0.5,
		custody: { period: "quarter", pct: 0, fixed: 6, min: 0, max: null, exemptValue: 0 },
		marketFee: null,
		cashInterest: { kind: "none" },
		investorProtection: PT_SII,
		depositGuarantee: PT_FGD,
		ptTaxReport: null,
		feeTaxes: PT_BANK_TAXES,
		note: true,
		sources: [{ label: "Preçário, secção 21 (PDF)", url: "https://www.big.pt/pdf/BIG018b_precario.pdf" }],
		checked: CHECKED,
	},
	{
		// Preçário de Títulos PC0011 of 4 May 2026, Internet/Mobile column: foreign markets 0.15%,
		// min €8 on Euronext Amsterdam, min USD 15 in the US; stamp duty 4%. Custody €6 a quarter + VAT
		// per current account, at the internet rate only after a trade on the site or app in the three
		// previous months (otherwise €9). FX at internal rates, no spread published.
		id: "millennium-bcp",
		name: "Millennium BCP",
		entity: "Banco Comercial Português, S.A.",
		country: "PT",
		regulator: "Banco de Portugal, CMVM",
		etfVenue: "Euronext Amsterdam",
		etfEu: order({ pct: 0.15, min: 8 }),
		etfSavingsPlan: null,
		usStock: order({ currency: "USD", pct: 0.15, min: 15 }),
		fxPct: null,
		custody: { period: "quarter", pct: 0, fixed: 6, min: 0, max: null, exemptValue: 0 },
		marketFee: null,
		cashInterest: null,
		investorProtection: PT_SII,
		depositGuarantee: PT_FGD,
		ptTaxReport: null,
		feeTaxes: PT_BANK_TAXES,
		note: true,
		sources: [{ label: "Preçário de Títulos (PDF)", url: "https://investimentos.millenniumbcp.pt/pt/Documents/PC0011-PT.PDF" }],
		checked: CHECKED,
	},
]

/**
 * Provenance shared by the two bank-account comparison tables. The owner supplied the tables as of
 * the date below; nothing here is fetched at runtime, and a newer table replaces these modules.
 */
export const BANK_ACCOUNTS_SOURCE = {
	asOf: "2026-11-19",
	note: "Conditions compiled by WonderMoney from the banks' published offers",
} as const

/** Deposit guarantee shown on both pages: per depositor and per credit institution. */
export const DEPOSIT_GUARANTEE = {
	amount: 100_000,
	url: "https://www.fgd.pt/en",
} as const

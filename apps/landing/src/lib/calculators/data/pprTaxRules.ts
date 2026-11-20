/**
 * The tax and redemption rules of a PPR (plano de poupança-reforma), read from the consolidated
 * texts the Portal das Finanças and the Diário da República publish:
 *
 * - Estatuto dos Benefícios Fiscais (EBF), artigo 21.º "Produtos individuais de reforma", in the
 *   Portal das Finanças' consolidated EBF (last update shown: Decreto-Lei n.º 167/2026, 17 August):
 *   n.º 2 (20% deduction and its limits by age), n.º 3 (tax on payouts), n.º 4 (deduction lost on an
 *   early redemption, plus 10% a year), n.º 5 (21.5% on the gain outside the legal cases), n.º 9
 *   (age on 1 January) and n.º 10 (no deduction after retirement).
 * - Código do IRS, artigo 78.º, n.º 7: the overall cap on deductions, by taxable income.
 * - Decreto-Lei n.º 158/2002, artigo 4.º (when a PPR can be redeemed without penalty, the five-year
 *   rule and the 35% rule) and artigo 6.º (transfers between PPR and their fees), consolidated text.
 *
 * Upkeep: check every January, and when a State Budget or a change to the EBF or Decreto-Lei
 * n.º 158/2002 is published, then update the figures and `PPR_TAX_RULES_REVIEWED`. Copy on the page
 * quotes these numbers through the module, so a change here reaches every locale.
 */

export const PPR_TAX_RULES_REVIEWED = "2026-11-20"

export const PPR_TAX_RULES = {
	/** Share of the year's contributions deductible from the IRS tax, in percent (EBF art. 21.º, n.º 2). */
	deductionRate: 20,
	/** Yearly deduction limit per taxpayer by age on 1 January of the year (EBF art. 21.º, n.os 2 and 9). */
	limits: [
		{ fromAge: 0, toAge: 34, limit: 400 },
		{ fromAge: 35, toAge: 50, limit: 350 },
		{ fromAge: 51, toAge: null, limit: 300 },
	],
	/** Years each contribution must stay in the plan before most legal redemptions (DL 158/2002 art. 4.º, n.º 2). */
	minYearsPerContribution: 5,
	/** Share of all contributions made in the first half of the plan that frees the whole value after five years (art. 4.º, n.º 3). */
	firstHalfShare: 35,
	/** Increase of the deduction to give back for each year or part of a year, in percent (EBF art. 21.º, n.º 4). */
	clawbackPerYear: 10,
	/** Tax on the gain of a lump-sum redemption in a legal case: 20% on two fifths of it (EBF art. 21.º, n.º 3, b). */
	legalRedemption: { rate: 20, taxedShare: 2 / 5 },
	/** Tax on the gain of a redemption outside the legal cases, in percent (EBF art. 21.º, n.º 5). */
	otherRedemptionRate: 21.5,
	/** Highest transfer fee where capital or return is guaranteed, in percent; none without a guarantee (DL 158/2002 art. 6.º). */
	maxGuaranteedTransferFee: 0.5,
	/** Overall cap on the deductions of CIRS art. 78.º, n.º 7, by taxable income band, in euros. */
	overallCap: { min: 1000, max: 2500 },
} as const

export const PPR_TAX_SOURCES = {
	ebf: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/Cod_download/Documents/EBF.pdf",
	cirs78: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/Cod_download/Documents/CIRS.pdf",
	dl158: "https://diariodarepublica.pt/dr/legislacao-consolidada/decreto-lei/2002-34431475",
} as const

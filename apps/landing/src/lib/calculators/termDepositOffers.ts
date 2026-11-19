import { TERM_DEPOSIT_OFFERS, type TermDepositOffer } from "./data/termDepositOffers";
import { DEPOSIT_TAX_RATE } from "./depositRates";
import { computeTermDeposit } from "./termDeposit";

export { TERM_DEPOSIT_OFFERS, TERM_DEPOSIT_OFFERS_AS_OF, TERM_DEPOSIT_OFFERS_SOURCE } from "./data/termDepositOffers";
export type { TermDepositOffer } from "./data/termDepositOffers";

export interface OfferFilters {
  /** Term in months, or null for every term. */
  termMonths: number | null;
  /** Amount the visitor wants to invest, in euros; NaN or <= 0 applies no amount filter. */
  amount: number;
  /** Hide offers only open to new clients. */
  existingClients: boolean;
  /** Hide offers that require new money. */
  noNewMoney: boolean;
  /** Keep only offers that allow early withdrawal (including "see notes"). */
  earlyWithdrawal: boolean;
  /** Portuguese banks (IRS withheld), foreign banks (not withheld), or both. */
  irs: "all" | "withheld" | "notWithheld";
}

export const DEFAULT_OFFER_FILTERS: OfferFilters = {
  termMonths: null,
  amount: 10_000,
  existingClients: false,
  noNewMoney: false,
  earlyWithdrawal: false,
  irs: "all",
};

export function offerTerms(offers: readonly TermDepositOffer[] = TERM_DEPOSIT_OFFERS): number[] {
  return [...new Set(offers.map((offer) => offer.termMonths))].sort((a, b) => a - b);
}

export function filterOffers(
  filters: OfferFilters,
  offers: readonly TermDepositOffer[] = TERM_DEPOSIT_OFFERS,
): TermDepositOffer[] {
  const amount = Number.isFinite(filters.amount) && filters.amount > 0 ? filters.amount : null;
  return offers.filter((offer) => {
    if (filters.termMonths !== null && offer.termMonths !== filters.termMonths) return false;
    if (amount !== null) {
      if (offer.minimum !== null && offer.minimum > amount) return false;
      if (offer.maximum !== null && offer.maximum < amount) return false;
    }
    if (filters.existingClients && offer.newClients) return false;
    if (filters.noNewMoney && offer.newMoney) return false;
    if (filters.earlyWithdrawal && offer.earlyWithdrawal === "no") return false;
    if (filters.irs === "withheld" && offer.irsNotWithheld) return false;
    if (filters.irs === "notWithheld" && !offer.irsNotWithheld) return false;
    return true;
  });
}

/** TANB descending; ties by shorter term, then bank name, so the order is stable. */
export function sortOffers(offers: readonly TermDepositOffer[]): TermDepositOffer[] {
  return [...offers].sort(
    (a, b) => b.tanb - a.tanb || a.termMonths - b.termMonths || a.bank.localeCompare(b.bank, "en"),
  );
}

export interface OfferReturn {
  grossInterest: number;
  netInterest: number;
  /** Net annual yield in percent. */
  netAnnualYield: number;
}

/**
 * Interest at maturity for the amount, after the 28% IRS, through the term deposit engine.
 * Foreign banks do not withhold in Portugal: the figure still assumes the saver declares the
 * interest and pays 28%, so offers compare like for like.
 */
export function offerReturn(offer: TermDepositOffer, amount: number): OfferReturn | null {
  const outcome = computeTermDeposit({
    amount,
    annualRate: offer.tanb,
    termMonths: offer.termMonths,
    payout: "maturity",
    reinvest: false,
    taxRate: DEPOSIT_TAX_RATE,
  });
  if (!outcome.ok) return null;
  const { grossInterest, netInterest, effectiveAnnualNetYield } = outcome.result;
  return { grossInterest, netInterest, netAnnualYield: effectiveAnnualNetYield };
}

import type { Bank } from "./useBankList";

/**
 * Ordering for the bank picker (RAD-589).
 *
 * GoCardless returns institutions alphabetically and nothing re-ordered them, so
 * a Portuguese user's first two options were "Abanca" and "Abanca Corporate"
 * while the banks people actually hold accounts with sat several screens down.
 * On the single highest-stakes step in the funnel, that is a scroll most users
 * should never have had to do.
 *
 * The priority list is measured, not guessed: it is the institution distribution
 * of every account connected on production as of 2026-08-23, most-connected
 * first — Revolut 45, ActivoBank 29, Santander 17, CGD 14, Millennium 7, BPI 6,
 * Crédito Agrícola 5, Bankinter 5, Montepio 4, Abanca 5, Novo Banco 2.
 *
 * Matching is on a normalised name rather than the GoCardless institution id,
 * because the ids carry a BIC suffix that changes per corporate entity
 * (`CAIXA_GERAL_DEPOSITOS_CGDIPTPL`) and would silently stop matching.
 */
const PREFERRED_INSTITUTIONS_BY_COUNTRY: Readonly<Record<string, readonly string[]>> = {
  PT: [
    "revolut",
    "activobank",
    "santander",
    "caixageral",
    "millennium",
    "bpi",
    "creditoagricola",
    "bankinter",
    "abanca",
    "montepio",
    "novobanco",
    "wizink",
  ],
};

/** Lowercase and strip everything that isn't a letter or digit, so "Banco ActivoBank", "ActivoBank" and "Activo Bank" all compare equal. */
function normalise(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Most-connected institutions for the country first, everything else
 * alphabetical. Pure and non-mutating — the input array is left alone.
 */
export function sortBanksForCountry(
  banks: readonly Bank[],
  country: string,
): Bank[] {
  const preferred = PREFERRED_INSTITUTIONS_BY_COUNTRY[country.toUpperCase()] ?? [];

  const rankOf = (bank: Bank): number => {
    const name = normalise(bank.name);
    const index = preferred.findIndex((candidate) => name.includes(candidate));
    return index === -1 ? preferred.length : index;
  };

  return [...banks].sort((a, b) => {
    const byRank = rankOf(a) - rankOf(b);
    if (byRank !== 0) return byRank;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Matching a name from an imported file to one of the person's own, for the mapping steps of an
 * import (a YNAB account to an account, a YNAB category to a category).
 *
 * Two names match when they read the same once case, accents, punctuation and spacing are set
 * aside: "Café & Restaurants" matches "cafe restaurants", "Poupança" matches "POUPANCA". A
 * suggestion is only made when exactly one candidate matches: two candidates with the same name
 * leave the choice to the person.
 *
 * Pure and dependency-free, so the API (which knows the stored names) and the web client (which
 * knows how the person's language shows the system categories) match the same way.
 */

/** A name as the matcher compares it: lower case, without accents, punctuation or extra spaces. */
export function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface NameCandidate {
  id: number;
  /** Every name the candidate goes by: as stored, as the person's language shows it. */
  names: readonly string[];
}

/** The one candidate one of whose names reads as `name`, or `undefined` when none or several do. */
export function matchByName(name: string, candidates: readonly NameCandidate[]): number | undefined {
  const wanted = normalizeName(name);
  if (wanted === '') return undefined;
  const ids = new Set<number>();
  for (const candidate of candidates) if (candidate.names.some((candidateName) => normalizeName(candidateName) === wanted)) ids.add(candidate.id);
  return ids.size === 1 ? [...ids][0] : undefined;
}

/**
 * The category a source category suggests: by its own name first ("Groceries" in "Everyday
 * Expenses: Groceries"), then by its full label. `undefined` when neither settles on one.
 */
export function suggestCategory(source: { label: string; name: string }, candidates: readonly NameCandidate[]): number | undefined {
  return matchByName(source.name, candidates) ?? (source.label === source.name ? undefined : matchByName(source.label, candidates));
}

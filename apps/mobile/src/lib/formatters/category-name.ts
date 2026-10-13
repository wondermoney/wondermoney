/**
 * Category names as the system displays them.
 *
 * The API returns some category names in caps (`HOUSING`) and others in
 * sentence case (`Groceries`), so the same category rendered as "Housing" in
 * the picker and "HOUSING" in the net-worth insight on the same session. The
 * system has one house style for a label and it is not shouting
 * (`DESIGN.md`'s Typography section — sentence case only).
 *
 * Only all-caps words are touched, and only words longer than three letters —
 * so `ETF`, `IVA` and `USD` are left as the acronyms they are.
 *
 * The reports endpoints go further and return the raw key (`RENT_MORTGAGE`,
 * `CAFE_RESTAURANTS_BARS`), so underscores become spaces first.
 */
const ACRONYM_MAX = 3

/**
 * Short words that are not acronyms.
 *
 * The acronym guard protects `TV` and `ETF` by leaving short all-caps words
 * alone — which also protected the `AND` in `HOBBIES_AND_LEISURE`, so it
 * rendered as "Hobbies AND Leisure".
 */
const JOINING_WORDS = new Set(['and', 'or', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'a', 'an', 'per'])

export function formatCategoryName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .split(/(\s+|&|·|\/|-)/)
    .map((part) => {
      const word = part.trim()
      if (!word) return part
      if (JOINING_WORDS.has(word.toLocaleLowerCase())) {
        return part.replace(word, word.toLocaleLowerCase())
      }
      if (word.length <= ACRONYM_MAX) return part
      if (word !== word.toLocaleUpperCase() || word === word.toLocaleLowerCase()) return part
      return part.replace(word, word.charAt(0) + word.slice(1).toLocaleLowerCase())
    })
    .join('')
}

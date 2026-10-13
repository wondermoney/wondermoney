const NUMBER_PATTERN = /\d+(?:[.,]\d+)*/g;

// Currency amounts in this domain are exact to the cent (see `formatEur` in
// monthly-story-narrative-skeleton.ts, which always emits 2 decimal places) and percentages
// carry at most a couple of decimal digits. EPSILON exists only to absorb floating-point /
// LLM-formatting noise (e.g. an extra trailing decimal digit), not genuine value differences.
// Originally specified as 0.01 in the task brief, but that equals the smallest unit either value
// type actually carries (a full cent, or a full percentage-point-hundredth) — meaning a genuinely
// altered figure that happened to be off by exactly that unit would silently pass. Tightened to
// 0.005 (half that unit) per fix-round review: still clears the brief's own stated noise case
// (0.001) with 5x margin, while a full 1-cent/1-hundredth-point alteration now correctly fails
// the guardrail closed. See the "epsilon boundary" fix-round note in task-14-report.md.
const EPSILON = 0.005;

/**
 * Extracts every numeric value from a string, tolerant of pt-PT (1.234,50) and en (1,234.50)
 * formatting.
 *
 * Disambiguation rule (locale-agnostic — this function has no locale parameter):
 * - A separator character that repeats within one match can only be a thousands grouping — a
 *   decimal point can appear at most once in a well-formed number — so a repeated '.' or ',' is
 *   always treated as a thousands separator and stripped. This resolves numbers like "12.345.678"
 *   (pt-PT, no decimal part) or "12,345,678" (en, no decimal part) to 12345678, not a truncated
 *   or fractional value.
 * - When both '.' and ',' appear, whichever occurs LAST is the decimal separator and the other
 *   (wherever it appears) is a thousands separator — e.g. "1.234,50" and "1,234.50" both resolve
 *   to 1234.5.
 * - When only one separator type appears exactly once (e.g. "1.234"), it is genuinely ambiguous
 *   without locale context: pt-PT formatting would read this as 1234 (a thousands-only render of
 *   a round number), en formatting would read it as 1.234 (a decimal). This function treats the
 *   lone separator as a decimal point. That is a deliberate trade-off, not an oversight: it is
 *   the direction that fails the guardrail closed (rejects a possibly-valid reformat) rather than
 *   open (silently accepting a possibly-altered value) — and in practice this app's own
 *   generator always renders money to 2 decimal places, so this specific ambiguity can only be
 *   introduced by the LLM's own reformatting. See monthly-story-narrative-guardrail.test.ts for
 *   the locked-in behavior of this case.
 */
export function extractNumericValues(text: string): number[] {
  const matches = text.match(NUMBER_PATTERN) ?? [];
  return matches
    .map((match) => {
      const dotCount = (match.match(/\./g) ?? []).length;
      const commaCount = (match.match(/,/g) ?? []).length;
      if (dotCount === 0 && commaCount === 0) return Number(match);

      let decimalSeparator: string | undefined;
      if (dotCount >= 1 && commaCount >= 1) {
        decimalSeparator = match.lastIndexOf('.') > match.lastIndexOf(',') ? '.' : ',';
      } else if (dotCount === 1 || commaCount === 1) {
        decimalSeparator = dotCount === 1 ? '.' : ',';
      }
      // Otherwise the sole separator type repeats (2+ times) with no other type present — it is
      // purely thousands grouping, there is no decimal part.
      if (!decimalSeparator) return Number(match.replaceAll(/[.,]/g, ''));

      const decimalSeparatorIndex = match.lastIndexOf(decimalSeparator);
      const integerPart = match.slice(0, decimalSeparatorIndex).replaceAll(/[.,]/g, '');
      const fractionPart = match.slice(decimalSeparatorIndex + 1);
      return Number(`${integerPart}.${fractionPart}`);
    })
    .filter((value) => !Number.isNaN(value));
}

/**
 * Compares the multiset of numeric VALUES (not raw strings/tokens) between the deterministic
 * input skeleton and the LLM's polished output. Tolerant of reformatting (currency symbols,
 * decimal padding, thousands separators, sign markers — `extractNumericValues` drops leading
 * minus signs, so this compares magnitudes only); strict on added, dropped, or altered figures.
 */
export function guardrailPasses(inputSentences: string[], outputSentences: string[]): boolean {
  const inputValues = inputSentences.flatMap(extractNumericValues).sort((a, b) => a - b);
  const outputValues = outputSentences.flatMap(extractNumericValues).sort((a, b) => a - b);
  if (inputValues.length !== outputValues.length) return false;
  return inputValues.every((value, index) => Math.abs(value - outputValues[index]!) <= EPSILON);
}

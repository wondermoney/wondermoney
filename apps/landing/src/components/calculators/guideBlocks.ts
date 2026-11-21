/**
 * Data shapes for the calculator guide building blocks, beside ToolGuide.astro:
 *
 * - GuideTermList.astro: a definition list ("Surplus" in bold, its explanation after it),
 *   in place of "Term: body" bullets. Items are `GuideTerm`s.
 * - GuideFigures.astro: the figures of a worked example as value cards, either a flow
 *   (income − expenses = surplus → savings rate) or a grid with optional share bars. Items
 *   are `GuideFigure`s, built from the calculator's own computation, never typed numbers.
 * - GuideFormula.astro: one formula per line in a readable form (result = a − b, fractions
 *   stacked), each variable linking to the note that explains it. Formulas are built with
 *   `variable`, `number`, `operator`, `fraction` and `group` below; `group` puts parts in
 *   parentheses, with an optional exponent ((1 + rate)^years).
 *
 * Give every note a formula links to an `id` that does not change with the locale (an
 * English slug prefixed with the guide's name, such as `household-budget-note-income`), so
 * a link to it survives translation. `formulaHrefs` lists a guide's links for its test.
 */
import type { LucideIcon } from "lucide-react";

/** One entry of a term list: a term and its explanation, with an id when something links to it. */
export type GuideTerm = {
  term: string;
  body: string;
  id?: string;
};

export type GuideFigureTone = "default" | "positive" | "negative";

/** One value card of a worked example. */
export type GuideFigure = {
  label: string;
  /** The formatted value, from the calculator's own result. */
  value: string;
  icon?: LucideIcon;
  /** A short line under the value, such as how it is worked out ("640 € ÷ 2850 €"). */
  detail?: string;
  /** A share from 0 to 100, drawn as a bar under the value (grid variant). */
  share?: number | null;
  /** The share as text, such as "29,8%"; shown beside the bar. */
  shareLabel?: string;
  tone?: GuideFigureTone;
};

/** The operator printed between two cards of a flow, such as "−", "=" or "→". */
export type GuideFlowOperator = "+" | "−" | "×" | "÷" | "=" | "→";

export type GuideFormulaVariable = { kind: "variable"; label: string; href?: string };
export type GuideFormulaPart =
  | GuideFormulaVariable
  | { kind: "number"; value: string }
  | { kind: "operator"; symbol: "+" | "−" | "×" | "÷" | "=" }
  | { kind: "fraction"; numerator: GuideFormulaPart[]; denominator: GuideFormulaPart[] }
  | { kind: "group"; parts: GuideFormulaPart[]; exponent?: GuideFormulaPart[] };

/** One line of a formula block: `result = expression`. */
export type GuideFormulaLine = {
  result: GuideFormulaVariable;
  expression: GuideFormulaPart[];
};

/** A variable, linking to its note when `id` is given (the note's id, without "#"). */
export function variable(label: string, id?: string): GuideFormulaVariable {
  return id ? { kind: "variable", label, href: `#${id}` } : { kind: "variable", label };
}

/** A constant, such as the 100 of a percentage. Pass it formatted for the locale. */
export function number(value: string): GuideFormulaPart {
  return { kind: "number", value };
}

export function operator(symbol: "+" | "−" | "×" | "÷" | "="): GuideFormulaPart {
  return { kind: "operator", symbol };
}

/** A division drawn as a fraction: the numerator over the denominator. */
export function fraction(numerator: GuideFormulaPart[], denominator: GuideFormulaPart[]): GuideFormulaPart {
  return { kind: "fraction", numerator, denominator };
}

/**
 * Parts in parentheses, raised to `exponent` when given: `group([number("1"), operator("+"),
 * variable("rate")], [variable("years")])` reads (1 + rate)^years. Keep an exponent short and
 * inline (a ÷ b rather than a fraction).
 */
export function group(parts: GuideFormulaPart[], exponent?: GuideFormulaPart[]): GuideFormulaPart {
  return exponent ? { kind: "group", parts, exponent } : { kind: "group", parts };
}

/** Every link in a set of formula lines, results first, in reading order. */
export function formulaHrefs(lines: ReadonlyArray<GuideFormulaLine>): string[] {
  const fromParts = (parts: ReadonlyArray<GuideFormulaPart>): string[] =>
    parts.flatMap((part) => {
      if (part.kind === "variable") return part.href ? [part.href] : [];
      if (part.kind === "fraction") return [...fromParts(part.numerator), ...fromParts(part.denominator)];
      if (part.kind === "group") return [...fromParts(part.parts), ...fromParts(part.exponent ?? [])];
      return [];
    });
  return lines.flatMap((line) => fromParts([line.result, ...line.expression]));
}

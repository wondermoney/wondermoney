export type FormulaVariable = {
  label?: string;
  name?: string;
  symbol?: string;
  meaning?: string;
  value?: string | number;
};

export type FormulaInput = {
  title?: string;
  expression?: string;
  variables?: ReadonlyArray<FormulaVariable>;
  notes?: string;
};

/** Whether a glossary term's formula has an expression, variables or notes to show. */
export function hasFormulaContent(formula?: FormulaInput | null): formula is FormulaInput {
  return Boolean(formula?.expression?.trim() || (formula?.variables?.length ?? 0) > 0 || formula?.notes?.trim());
}

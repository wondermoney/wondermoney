export type SavingsRateParams = {
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyDeductions: number;
  includeDuodecimos: boolean;
  duodecimosAnnualAmount: number;
};

export type SavingsRateResult = {
  monthlySavings: number;
  savingsRate: number;
  annualSavings: number;
};

export function computeSavingsRate(
  params: SavingsRateParams,
): SavingsRateResult {
  const duodecimosMonthly = params.includeDuodecimos
    ? params.duodecimosAnnualAmount / 12
    : 0;
  const effectiveIncome =
    params.monthlyIncome - params.monthlyDeductions + duodecimosMonthly;
  const monthlySavings = effectiveIncome - params.monthlyExpenses;
  const savingsRate =
    effectiveIncome > 0 ? (monthlySavings / effectiveIncome) * 100 : 0;

  return {
    monthlySavings,
    savingsRate: Math.round(savingsRate * 10) / 10,
    annualSavings: monthlySavings * 12,
  };
}

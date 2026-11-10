export type CompoundInterestParams = {
  principal: number;
  monthlyContribution: number;
  annualRate: number;
  years: number;
};

export type CompoundInterestPoint = {
  year: number;
  contributions: number;
  interest: number;
};

export type CompoundInterestResult = {
  chartData: CompoundInterestPoint[];
  finalBalance: number;
  totalContributions: number;
  totalInterest: number;
};

export function computeCompoundInterest(
  params: CompoundInterestParams,
): CompoundInterestResult {
  const monthlyRate = params.annualRate / 100 / 12;
  const data: CompoundInterestPoint[] = [];

  let balance = params.principal;
  let totalContrib = params.principal;

  for (let y = 1; y <= params.years; y++) {
    for (let m = 0; m < 12; m++) {
      balance = balance * (1 + monthlyRate) + params.monthlyContribution;
      totalContrib += params.monthlyContribution;
    }

    data.push({
      year: y,
      contributions: Math.round(totalContrib),
      interest: Math.round(balance - totalContrib),
    });
  }

  return {
    chartData: data,
    finalBalance: Math.round(balance),
    totalContributions: Math.round(totalContrib),
    totalInterest: Math.round(balance - totalContrib),
  };
}

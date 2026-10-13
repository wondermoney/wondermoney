export const MIN_METRICS_HISTORY_SNAPSHOTS = 30;

export function calculateAnnualizedYield(totalReturn: number, daysHeld: number): null | number {
  if (daysHeld < MIN_METRICS_HISTORY_SNAPSHOTS) {
    return null;
  }
  return (Math.pow(1 + totalReturn / 100, 365 / daysHeld) - 1) * 100;
}

export function calculateTotalReturn(currentValue: number, costBasis: number): number {
  if (costBasis === 0) {
    return 0;
  }
  return ((currentValue - costBasis) / costBasis) * 100;
}

export function calculateVolatility(snapshots: { totalValue: number }[]): null | number {
  if (snapshots.length < MIN_METRICS_HISTORY_SNAPSHOTS) {
    return null;
  }

  // Calculate daily returns from consecutive snapshot values
  const dailyReturns: number[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1]!.totalValue;
    const curr = snapshots[i]!.totalValue;
    if (prev > 0) {
      dailyReturns.push((curr - prev) / prev);
    }
  }

  if (dailyReturns.length === 0) {
    return null;
  }

  // Calculate average return
  const avgReturn = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;

  // Calculate variance
  const variance =
    dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / dailyReturns.length;

  // Annualized volatility (sqrt(252) for trading days)
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

export function determineRiskLevel(volatility: null | number): 'High' | 'Low' | 'Medium' | null {
  if (volatility === null) {
    return null;
  }
  if (volatility < 15) {
    return 'Low';
  } else if (volatility < 25) {
    return 'Medium';
  } else {
    return 'High';
  }
}

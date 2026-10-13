interface FirstNetWorthState {
  accountCount: number;
  isLoaded: boolean;
  portfolioCount?: number;
}

export function isValidFirstNetWorthState({
  accountCount,
  isLoaded,
  portfolioCount = 0,
}: FirstNetWorthState): boolean {
  return isLoaded && accountCount + portfolioCount > 0;
}

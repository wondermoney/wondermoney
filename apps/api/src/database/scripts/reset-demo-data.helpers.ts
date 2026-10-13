export function assertDemoResetPreflight(input: { pendingImports: number; pendingOperations: number }) {
  if (input.pendingImports > 0 || input.pendingOperations > 0) {
    throw new Error(
      `Demo reset preflight failed: ${JSON.stringify({
        pendingImports: input.pendingImports,
        pendingOperations: input.pendingOperations,
      })}`,
    );
  }
}

export function buildResetInvariantSummary(input: {
  accounts: number;
  budgets: number;
  loans: number;
  pendingImports: number;
  pendingOperations: number;
  portfolios: number;
}) {
  return {
    hasAtLeastTwoDemoAccounts: input.accounts >= 2,
    hasBudget: input.budgets >= 1,
    hasLoan: input.loans >= 1,
    hasPortfolio: input.portfolios >= 1,
    noPendingDemoBackgroundOperations: input.pendingOperations === 0,
    noPendingDemoImports: input.pendingImports === 0,
  };
}

export function ensureAtLeastOneDemoEntity<T>(entities: T[], label: string): T {
  if (entities.length < 1) {
    throw new Error(`Expected at least one active ${label}, found ${entities.length}`);
  }
  return entities[0] as T;
}

export function ensureSingleDemoEntity<T>(entities: T[], label: string): T {
  if (entities.length !== 1) {
    throw new Error(`Expected exactly one active ${label}, found ${entities.length}`);
  }
  return entities[0] as T;
}

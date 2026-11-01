import { useCallback, useEffect, useRef } from "react";

export const WIZARD_START_ROUTE = "/budgets/wizard";

/**
 * The categories step edits a budget the income step already created, so it
 * sends the user back to the start of the wizard when there is none.
 *
 * Finish clears the wizard store before it navigates to the new budget, which
 * also leaves no budget id behind. Call the returned `leaveWizard` first so
 * that clearing is not mistaken for a missing budget: otherwise this redirect
 * runs after Finish's navigation and wins, landing the user on the wizard's
 * first step instead of their budget (#67).
 */
export function useRequireWizardBudget(
  budgetId: number | undefined,
  router: { replace: (href: string) => void },
) {
  const isLeavingRef = useRef(false);

  useEffect(() => {
    if (!budgetId && !isLeavingRef.current) {
      router.replace(WIZARD_START_ROUTE);
    }
  }, [budgetId, router]);

  return useCallback(() => {
    isLeavingRef.current = true;
  }, []);
}

import type { FirstRunStep } from "./types";
import { FIRST_RUN_STEP_ROUTES } from "./types";

/**
 * Restoring an export instead of setting up: not a numbered step, but inside onboarding, so the
 * first-run gate lets the person stay on it.
 */
export const FIRST_RUN_RESTORE_ROUTE = "/onboarding/restore";

export function getFirstRunStepRoute(step: FirstRunStep): string {
  return FIRST_RUN_STEP_ROUTES[step];
}

export function getFirstRunStepFromPathname(
  pathname: string,
): FirstRunStep | undefined {
  const route = Object.entries(FIRST_RUN_STEP_ROUTES).find(([, routePath]) =>
    pathname.endsWith(routePath),
  );
  return route?.[0] as FirstRunStep | undefined;
}

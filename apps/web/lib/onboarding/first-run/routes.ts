import type { FirstRunStep } from "./types";
import { FIRST_RUN_STEP_ROUTES } from "./types";

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

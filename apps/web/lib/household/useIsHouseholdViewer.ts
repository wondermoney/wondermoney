"use client";

import useHousehold from "@/lib/api/household/useHousehold";

import { findMe } from "./permissions";

/**
 * Whether the signed-in person is a viewer of their household, who can read its shared data but
 * not change it (every write answers 403 `household_read_only`, which
 * `HouseholdReadOnlyNotifier` explains). Screens use it to leave write actions out. False while
 * the household loads, or on an API that does not say who the caller is: the API stays the
 * authority either way.
 */
export function useIsHouseholdViewer(): boolean {
  const { data } = useHousehold();
  return data ? findMe(data, null)?.role === "viewer" : false;
}

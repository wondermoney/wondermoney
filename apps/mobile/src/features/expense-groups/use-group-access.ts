import { useHousehold } from '@/features/household/use-household'

import { householdCandidates, isHouseholdViewer } from './expense-groups-view-model'

/**
 * Whether the reader may change groups. A household viewer reads them only, so the screens hide
 * every write; until the household loads (or when it cannot), writes show and the API decides.
 */
export function useGroupAccess() {
  const household = useHousehold()
  return {
    canWrite: !isHouseholdViewer(household.data),
    household: household.data ?? null,
    candidates: householdCandidates(household.data),
  }
}

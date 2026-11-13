import { useMemo } from 'react'

import { householdMembersModel, type HouseholdMembersModel } from './member-attribution'
import { useHousehold } from './use-household'

/**
 * The household's members for the member filter, badges and "Spent by" (issue #96). While the
 * household loads, or when it can't be read, it reads as one member and no member UI shows.
 */
export function useHouseholdMembers(): HouseholdMembersModel {
  const household = useHousehold()
  return useMemo(() => householdMembersModel(household.data), [household.data])
}

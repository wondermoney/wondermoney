"use client";

import type { HouseholdMember } from "@/lib/api/household/types";
import useHousehold from "@/lib/api/household/useHousehold";

export interface HouseholdMembers {
  /**
   * The household's members when there is more than one, else empty: every member control
   * (filter, badges, "Spent by", the joint switch) hides for a household of one, and while the
   * household is loading.
   */
  members: HouseholdMember[];
  viewerAppuserKey: number | null;
}

const NONE: HouseholdMembers = { members: [], viewerAppuserKey: null };

export function useHouseholdMembers(): HouseholdMembers {
  const { data } = useHousehold();
  if (!data || data.members.length <= 1) return NONE;
  return { members: data.members, viewerAppuserKey: data.viewerAppuserKey };
}

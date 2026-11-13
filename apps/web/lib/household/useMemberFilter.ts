"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { useRouter } from "@/i18n/navigation";
import useHousehold from "@/lib/api/household/useHousehold";

import {
  MEMBER_FILTER_PARAM,
  type MemberFilter,
  memberFilterParam,
  memberKeysFor,
  parseMemberFilter,
  resolveMemberFilter,
} from "./member-attribution";

/**
 * The page's member filter, kept in the URL (`?member=<appuserKey>|shared`) like the other
 * navigable filters, so a filtered view survives a reload and travels in a link.
 *
 * Until the household loads, the URL's value is trusted as it stands, so a filtered page asks for
 * its filtered data once rather than first unfiltered; once it loads, a value that names nobody in
 * the household (or any value, in a household of one) reads as "Everyone".
 */
export function useMemberFilter() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: household } = useHousehold();

  const raw = searchParams?.get(MEMBER_FILTER_PARAM) ?? null;
  const filter = useMemo<MemberFilter>(() => {
    const parsed = parseMemberFilter(raw);
    return household ? resolveMemberFilter(parsed, household.members) : parsed;
  }, [household, raw]);

  const setFilter = useCallback(
    (next: MemberFilter) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      const value = memberFilterParam(next);
      if (value) params.set(MEMBER_FILTER_PARAM, value);
      else params.delete(MEMBER_FILTER_PARAM);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const memberKeys = useMemo(() => memberKeysFor(filter), [filter]);

  return { filter, memberKeys, setFilter };
}

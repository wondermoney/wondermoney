"use client";

import { useTranslations } from "next-intl";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import type { HouseholdMember } from "@/lib/api/household/types";
import {
  memberDisplayName,
  type MemberFilter,
  SHARED_MEMBER,
} from "@/lib/household/member-attribution";
import { useHouseholdMembers } from "@/lib/household/useHouseholdMembers";
import { useMemberFilter } from "@/lib/household/useMemberFilter";
import { cn } from "@/lib/utils";

/** Radix Select refuses an empty value, so "no filter" needs a name of its own. */
const EVERYONE = "everyone";

interface MemberFilterSelectProps {
  members: readonly HouseholdMember[];
  value: MemberFilter;
  onChange: (value: MemberFilter) => void;
  className?: string;
}

/**
 * Everyone, one member, or Shared. Renders nothing for a household of one, where there is nobody
 * to tell apart.
 */
export function MemberFilterSelect({
  members,
  value,
  onChange,
  className,
}: MemberFilterSelectProps) {
  const t = useTranslations("household.attribution");
  if (members.length <= 1) return null;

  return (
    <Select
      value={value === null ? EVERYONE : String(value)}
      onValueChange={(next) =>
        onChange(
          next === EVERYONE
            ? null
            : next === SHARED_MEMBER
              ? SHARED_MEMBER
              : Number(next),
        )
      }
    >
      <SelectTrigger
        aria-label={t("filterLabel")}
        className={cn("w-full sm:w-44", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={EVERYONE}>{t("everyone")}</SelectItem>
        {members.map((member) => (
          <SelectItem key={member.appuserKey} value={String(member.appuserKey)}>
            {memberDisplayName(member)}
          </SelectItem>
        ))}
        <SelectItem value={SHARED_MEMBER}>{t("shared")}</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** The member filter of the page it sits on, read from and written to the URL's `member`. */
export function MemberFilterControl({ className }: { className?: string }) {
  const { members } = useHouseholdMembers();
  const { filter, setFilter } = useMemberFilter();
  return (
    <MemberFilterSelect
      members={members}
      value={filter}
      onChange={setFilter}
      className={className}
    />
  );
}

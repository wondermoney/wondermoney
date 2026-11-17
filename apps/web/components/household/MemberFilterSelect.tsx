"use client";

import { UserRound, UsersRound } from "lucide-react";
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
  compactOnMobile?: boolean;
  iconOnly?: boolean;
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
  compactOnMobile = false,
  iconOnly = false,
}: MemberFilterSelectProps) {
  const t = useTranslations("household.attribution");
  if (members.length <= 1) return null;
  const selectedMember = members.find((member) => member.appuserKey === value);
  const selected =
    value === null
      ? t("everyone")
      : value === SHARED_MEMBER
        ? t("shared")
        : selectedMember
          ? memberDisplayName(selectedMember)
          : t("filterLabel");

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
        className={cn(
          "w-full sm:w-44",
          className,
          compactOnMobile &&
            !iconOnly &&
            "relative max-sm:size-11 max-sm:w-11 max-sm:justify-center max-sm:border-transparent max-sm:p-0 max-sm:[&>svg:last-child]:hidden",
          iconOnly &&
            "relative size-11 w-11 justify-center border-transparent p-0 sm:w-11 [&>svg:last-child]:hidden",
          iconOnly && value !== null && "text-primary",
          compactOnMobile &&
            !iconOnly &&
            value !== null &&
            "max-sm:text-primary",
        )}
        title={`${t("filterLabel")}: ${selected}`}
        aria-description={selected}
      >
        {compactOnMobile || iconOnly ? (
          value !== null && value !== SHARED_MEMBER ? (
            <UserRound
              className={cn("size-4", !iconOnly && "sm:hidden")}
              aria-hidden="true"
            />
          ) : (
            <UsersRound
              className={cn("size-4", !iconOnly && "sm:hidden")}
              aria-hidden="true"
            />
          )
        ) : null}
        {(compactOnMobile || iconOnly) && value !== null ? (
          <span
            aria-hidden="true"
            className={cn(
              "bg-primary absolute top-1 right-1 size-1.5 rounded-full",
              !iconOnly && "sm:hidden",
            )}
          />
        ) : null}
        <span
          className={
            iconOnly
              ? "sr-only"
              : compactOnMobile
                ? "max-sm:sr-only"
                : undefined
          }
        >
          <SelectValue />
        </span>
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
export function MemberFilterControl({
  className,
  iconOnly = false,
}: {
  className?: string;
  iconOnly?: boolean;
}) {
  const { members } = useHouseholdMembers();
  const { filter, setFilter } = useMemberFilter();
  return (
    <MemberFilterSelect
      members={members}
      compactOnMobile
      iconOnly={iconOnly}
      value={filter}
      onChange={setFilter}
      className={className}
    />
  );
}

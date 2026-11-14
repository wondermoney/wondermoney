"use client";

import { Users } from "lucide-react";
import { useTranslations } from "next-intl";

import { memberInitials } from "@/lib/household/member-attribution";
import { cn } from "@/lib/utils";

interface MemberBadgeProps {
  /** Whose money it is: a member's key, or null for Shared (the household as a whole). */
  appuserKey: number | null;
  /** The member's name as the API sends it; ignored for Shared. */
  displayName: string | null;
  className?: string;
}

/**
 * Whose an account or a transaction is, in a household of more than one: a member's initials, or
 * the household icon for Shared. Neutral tokens only — it identifies a person, not a status, and
 * the merchant palette is for merchants. The name is its accessible label and tooltip.
 *
 * Callers render it only in a multi-member household (`useHouseholdMembers`).
 */
export function MemberBadge({ appuserKey, displayName, className }: MemberBadgeProps) {
  const t = useTranslations("household.attribution");
  const isShared = appuserKey === null;
  const name = displayName?.trim();
  // A member the API did not name is nobody the badge can label.
  if (!isShared && !name) return null;
  const label = isShared ? t("shared") : (name as string);

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-member={isShared ? "shared" : String(appuserKey)}
      className={cn(
        "border-border bg-muted text-muted-foreground inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.625rem] leading-none font-medium",
        className,
      )}
    >
      {isShared ? (
        <Users className="size-3" aria-hidden="true" />
      ) : (
        <span aria-hidden="true">{memberInitials(label)}</span>
      )}
    </span>
  );
}

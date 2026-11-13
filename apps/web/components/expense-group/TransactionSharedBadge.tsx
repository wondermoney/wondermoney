"use client";

import { Users } from "lucide-react";
import { useTranslations } from "next-intl";

import { badgeVariants } from "@/components/ui/badge";
import { Link } from "@/components/ui/Link";
import type { Transaction } from "@/lib/api/account/useTransactions";
import { sharedGroupOf } from "@/lib/expense-group/expense-group";
import { cn } from "@/lib/utils";

/**
 * The row's "Shared" badge: the transaction is shared in an expense group, and the badge opens
 * the group. Clicking it does not also open the row.
 */
export function TransactionSharedBadge({
  transaction,
  className,
}: {
  transaction: Pick<Transaction, "splits">;
  className?: string;
}) {
  const t = useTranslations("expenseGroups.share");
  const groupKey = sharedGroupOf(transaction);
  if (groupKey === null) return null;
  return (
    // The row opens on click; the badge is a link of its own.
    <span className="contents" onClick={(event) => event.stopPropagation()}>
      <Link
        href={`/groups/${groupKey}`}
        aria-label={t("badge-label")}
        className={cn(
          badgeVariants({ variant: "secondary" }),
          "text-muted-foreground hover:text-foreground h-5 shrink-0 gap-1 rounded-full px-2 text-xs font-normal",
          className,
        )}
      >
        <Users className="size-3" aria-hidden />
        {t("badge")}
      </Link>
    </span>
  );
}

"use client";

import { ChevronRight, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Amount } from "@/components/ui/Amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import DataLoadError from "@/components/ui/DataLoadError";
import { Link } from "@/components/ui/Link";
import { TableSkeleton } from "@/components/ui/PageSkeleton";
import type { ExpenseGroup } from "@/lib/api/expense-group/types";
import { useExpenseGroups } from "@/lib/api/expense-group/useExpenseGroups";
import {
  balanceStatus,
  nonZeroBalances,
  partitionGroups,
} from "@/lib/expense-group/expense-group";
import { useIsHouseholdViewer } from "@/lib/household/useIsHouseholdViewer";

import { CreateExpenseGroupDialog } from "./CreateExpenseGroupDialog";

/** "You owe €12.00" / "You are owed $5.00" per currency, or "Settled up". */
export function YourBalances({ group }: { group: ExpenseGroup }) {
  const t = useTranslations("expenseGroups.your-balance");
  const inGroup = group.members.some((member) => member.isYou);
  if (!inGroup) {
    return <span className="text-muted-foreground">{t("not-in-group")}</span>;
  }
  const balances = nonZeroBalances(group.yourBalances);
  if (balances.length === 0) {
    return <span className="text-muted-foreground">{t("settled")}</span>;
  }
  return (
    <span className="flex flex-col items-end gap-0.5">
      {balances.map((balance) => {
        const status = balanceStatus(balance.amount);
        const amount = (
          <Amount
            value={Math.abs(balance.amount)}
            currency={balance.currencyCode}
            className="font-mono"
          />
        );
        return (
          <span key={balance.currencyCode}>
            {t.rich(status === "owed" ? "owed" : "owes", {
              amount: () => amount,
            })}
          </span>
        );
      })}
    </span>
  );
}

function GroupRows({ groups }: { groups: ExpenseGroup[] }) {
  const t = useTranslations("expenseGroups");
  return (
    <Card>
      <ul className="divide-border divide-y">
        {groups.map((group) => (
          <li key={group.expenseGroupKey}>
            <Link
              href={`/groups/${group.expenseGroupKey}`}
              className="hover:bg-accent flex min-h-14 items-center justify-between gap-4 rounded-none px-4 py-3 text-sm transition-colors"
            >
              <span className="min-w-0 space-y-0.5">
                <span className="flex items-center gap-2">
                  <span className="text-foreground truncate font-medium">
                    {group.name}
                  </span>
                  {group.archived ? (
                    <Badge variant="muted" className="font-normal">
                      {t("archived-badge")}
                    </Badge>
                  ) : null}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {t("people-count", { count: group.members.length })}
                  {" · "}
                  {group.currencyCode}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-right">
                <YourBalances group={group} />
                <ChevronRight
                  className="text-muted-foreground size-4"
                  aria-hidden
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The Groups page: the household's groups, active first, archived ones apart. */
export function ExpenseGroupsList() {
  const t = useTranslations("expenseGroups");
  const readOnly = useIsHouseholdViewer();
  const query = useExpenseGroups();
  const [creating, setCreating] = useState(false);
  const { active, archived } = partitionGroups(query.data ?? []);

  const newGroup = readOnly ? null : (
    <Button onClick={() => setCreating(true)}>
      <Plus className="size-4" aria-hidden />
      {t("new")}
    </Button>
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
        actions={newGroup}
      />

      {query.isPending ? (
        <TableSkeleton rows={4} columns={2} />
      ) : query.isError ? (
        <DataLoadError onRetry={() => void query.refetch()} />
      ) : active.length === 0 && archived.length === 0 ? (
        <Card className="space-y-2 p-6">
          <h2 className="text-foreground text-base font-semibold">
            {t("empty.title")}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t("empty.description")}
          </p>
        </Card>
      ) : (
        <>
          {active.length > 0 ? <GroupRows groups={active} /> : null}
          {archived.length > 0 ? (
            <section className="space-y-3" aria-labelledby="archived-groups">
              <h2
                id="archived-groups"
                className="text-muted-foreground text-sm font-medium"
              >
                {t("archived-heading")}
              </h2>
              <GroupRows groups={archived} />
            </section>
          ) : null}
        </>
      )}

      <CreateExpenseGroupDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

import { getTranslations } from "next-intl/server";

import BudgetsTable from "@/components/budget/BudgetsTable";
import { MemberFilterControl } from "@/components/household/MemberFilterSelect";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { Card } from "@/components/ui/card";
import { getServerApi } from "@/lib/api/api-server";
import { getBudgetsFull } from "@/lib/api/budget/useBudgetsFull";
import { getHousehold } from "@/lib/api/household/useHousehold";
import {
  MEMBER_FILTER_PARAM,
  memberKeysFor,
  parseMemberFilter,
  resolveMemberFilter,
} from "@/lib/household/member-attribution";

import { CreateBudgetButton } from "./create-budget-button";
import { CreateBudgetEmptyButton } from "./create-budget-empty-button";

export default async function BudgetsOverview({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations();
  const { locale } = await params;
  const api = await getServerApi(locale);

  // The member filter (`?member=`) narrows each budget's spending to one member's, or Shared.
  // Only a member of the household is sent: a stale link reads as everyone, not a refused request.
  const rawMember = (await searchParams)[MEMBER_FILTER_PARAM];
  const requested = parseMemberFilter(
    Array.isArray(rawMember) ? rawMember[0] : rawMember,
  );
  const member =
    requested === null
      ? null
      : resolveMemberFilter(requested, (await getHousehold(api)).members);
  const { budgets } = await getBudgetsFull(api, {
    memberKeys: memberKeysFor(member),
  });

  const hasBudgets = budgets && budgets.length > 0;

  if (!hasBudgets) {
    return <CreateBudgetEmptyButton />;
  }

  // "Budgets overview" was an `<h2>` and the "Budgets" card title under it an
  // `<h6>`, so the only route in the product with more than one budget on it
  // opened at level 2, skipped four levels, and never rendered an `<h1>` at
  // all — a screen reader's heading list read as two unrelated fragments.
  // `PageShell` / `PageHeader` / `SectionHeader` are the primitives the home
  // and reports surfaces already use for exactly this (guarded by
  // `test:page-layout`); they carry the `h1` → `h2` outline for free.
  return (
    <PageShell>
      <PageHeader
        title={t("budgets-overview")}
      />
      <section className="flex flex-col gap-2">
        <SectionHeader
          title={t("budgets")}
          actions={
            <>
              <MemberFilterControl className="w-36 sm:w-44" />
              <CreateBudgetButton />
            </>
          }
        />
        <Card className="border-none">
          <BudgetsTable budgets={budgets} />
        </Card>
      </section>
    </PageShell>
  );
}

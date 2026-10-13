import { getTranslations } from "next-intl/server";

import BudgetsTable from "@/components/budget/BudgetsTable";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { Card } from "@/components/ui/card";
import { getServerApi } from "@/lib/api/api-server";
import { getBudgetsFull } from "@/lib/api/budget/useBudgetsFull";

import { CreateBudgetButton } from "./create-budget-button";
import { CreateBudgetEmptyButton } from "./create-budget-empty-button";

export default async function BudgetsOverview({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const t = await getTranslations();
  const { locale } = await params;
  const api = await getServerApi(locale);
  const { budgets } = await getBudgetsFull(api);

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
        <SectionHeader title={t("budgets")} actions={<CreateBudgetButton />} />
        <Card className="border-none">
          <BudgetsTable budgets={budgets} />
        </Card>
      </section>
    </PageShell>
  );
}

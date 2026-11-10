"use client";

import { useTranslations } from "next-intl";

import { Amount } from "@/components/ui/Amount";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/components/ui/Link";
import { UnconvertedAmountsNotice } from "@/components/ui/UnconvertedAmountsNotice";
import type { AmountsCompleteness } from "@/lib/api/completeness";
import { cn } from "@/lib/utils";

/**
 * Says the list holds the rows behind a report total, and what they add up to.
 *
 * The sum comes from the API with the list's count (`totalAmount`), summed the
 * way the report sums: only spending lines of a split, in the viewer's
 * currency. So it matches the total the user clicked, and a row with no
 * exchange rate is named rather than silently missing.
 */
export function TransactionsReportScope({
  totalAmount,
  completeness,
}: {
  totalAmount?: number | null;
  completeness?: AmountsCompleteness | null;
}) {
  const t = useTranslations("transactionsPage.report-scope");

  return (
    <section
      aria-label={t("title")}
      className="border-border flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-1">
        <p className="text-foreground text-sm font-medium">{t("title")}</p>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
        <UnconvertedAmountsNotice completeness={completeness ?? undefined} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-muted-foreground text-sm">{t("sum")}</span>
          <Amount
            value={totalAmount ?? null}
            currency={completeness?.currencyCode}
            signed
            className="font-mono text-lg font-medium"
          />
        </div>
        <Link
          href="/accounts/transactions"
          className={cn(buttonVariants({ variant: "link" }), "h-auto p-0")}
        >
          {t("show-all")}
        </Link>
      </div>
    </section>
  );
}

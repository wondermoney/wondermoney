"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useDeferredValue, useMemo, useState } from "react";

import { Amount } from "@/components/ui/Amount";
import type { ChartConfig } from "@/components/ui/chart";
import { AreaLineChartBase, useChartFormatters } from "@/components/ui/charts";
import { Label } from "@/components/ui/Label";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { Section } from "@/components/ui/RuledSection";
import { API_ERROR_CODE, getApiErrorCode } from "@/lib/api/errors";
import type { LoanDetail, LoanProjection } from "@/lib/api/loan/types";
import useLoanProjection from "@/lib/api/loan/useLoanProjection";
import { parseAmountInput } from "@/lib/utils/number";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

/** A payment date is a calendar day; read it as one, not as UTC midnight. */
const calendarDay = (iso: string) => {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
};

/**
 * The payoff projection: the contract payment's payoff date, plus how much sooner an
 * extra monthly payment clears the loan. The chart draws both balance lines, so the gap
 * between them is the extra's effect.
 */
export default function LoanPayoffSection({ loan }: { loan: LoanDetail }) {
  const t = useTranslations("loans");
  const locale = useLocale();
  const formatCurrency = useFormatCurrency();
  const formatShortDate = useFormatShortDate();
  const { formatCompactCurrency } = useChartFormatters();
  const [extraText, setExtraText] = useState("");

  const parsedExtra = extraText.trim() === "" ? 0 : parseAmountInput(extraText, locale);
  const extra = parsedExtra !== null && parsedExtra > 0 ? parsedExtra : 0;
  // Typing a figure should not fire a request per keystroke; the deferred value lets
  // React coalesce the edits while the previous projection stays on screen.
  const deferredExtra = useDeferredValue(extra);

  const { data, error, isError, isFetching, isLoading } = useLoanProjection(
    loan.loanKey,
    { extra: deferredExtra },
    { placeholderData: keepPreviousData },
  );
  const projection = data?.projection;

  const chartDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }),
    [locale],
  );

  const chartConfig: ChartConfig = {
    baselineBalance: {
      color: "var(--chart-2)",
      label: t("detail.payoff.baseline"),
    },
    withExtraBalance: {
      color: "var(--chart-1)",
      label: t("detail.payoff.withExtra"),
    },
  };

  const money = (value: number) => (
    <Amount value={value} currency={loan.currency.code} className="font-mono" />
  );

  return (
    <Section
      id="loan-payoff-heading"
      title={t("detail.payoff.title")}
      busy={isLoading || isFetching}
    >
      <div className="mb-8 max-w-sm">
        <Label htmlFor="loan-payoff-extra">{t("detail.payoff.extraLabel")}</Label>
        <MoneyInput
          id="loan-payoff-extra"
          className="mt-2"
          currency={loan.currency.code}
          inputMode="decimal"
          onEvaluated={setExtraText}
          placeholder={t("detail.payoff.extraPlaceholder")}
          value={extraText}
          onChange={(event) => setExtraText(event.target.value)}
        />
        <p className="text-muted-foreground mt-2 text-sm">
          {t("detail.payoff.extraHelper")}
        </p>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">{t("detail.loading")}</p>
      ) : isError ? (
        <p className="text-muted-foreground text-sm">
          {getApiErrorCode(error) === API_ERROR_CODE.LOAN_PROJECTION_UNAVAILABLE
            ? t("detail.payoff.missingInputs")
            : t("detail.payoff.unavailable")}
        </p>
      ) : !projection ? (
        <p className="text-muted-foreground text-sm">
          {t("detail.payoff.empty")}
        </p>
      ) : !projection.paysOff ? (
        <div className="space-y-1">
          <p className="text-foreground text-sm font-medium">
            {t("detail.payoff.never")}
          </p>
          <p className="text-muted-foreground max-w-prose text-sm">
            {t("detail.payoff.neverBody")}
          </p>
        </div>
      ) : (
        <>
          <p className="text-muted-foreground mb-6 max-w-prose text-sm">
            {t("detail.payoff.subtitle")}
          </p>

          <dl className="mb-8 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">
                {t("detail.payoff.payoffDate")}
              </dt>
              <dd>{formatPayoffDate(projection, formatShortDate, t)}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">
                {t("detail.payoff.monthsSaved")}
              </dt>
              <dd>
                {projection.monthsSaved > 0
                  ? t("detail.payoff.monthCount", {
                      count: projection.monthsSaved,
                    })
                  : t("detail.payoff.noSavings")}
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">
                {t("detail.payoff.interestSaved")}
              </dt>
              <dd>
                {projection.interestSaved > 0
                  ? money(projection.interestSaved)
                  : t("detail.payoff.noSavings")}
              </dd>
            </div>
          </dl>

          <AreaLineChartBase
            data={projection.series}
            xKey="date"
            series={[
              { key: "baselineBalance", type: "line", strokeWidth: 2 },
              { key: "withExtraBalance", type: "line", strokeWidth: 2 },
            ]}
            config={chartConfig}
            showArea={false}
            className="h-[240px]"
            xFormatter={(value) =>
              chartDateFormatter.format(calendarDay(String(value)))
            }
            yFormatter={(value) =>
              formatCompactCurrency(value, loan.currency.code)
            }
            tooltipValueFormatter={(value) =>
              formatCurrency(Number(value), loan.currency.code)
            }
          />
        </>
      )}
    </Section>
  );
}

function formatPayoffDate(
  projection: LoanProjection,
  formatShortDate: (date: Date) => string,
  t: ReturnType<typeof useTranslations>,
) {
  if (!projection.payoffDate) return t("detail.payoff.never");
  return formatShortDate(calendarDay(projection.payoffDate));
}

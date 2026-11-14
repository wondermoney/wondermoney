"use client";

import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useMemo } from "react";

import AccountsFreshness from "@/components/account/AccountsFreshness";
import { Amount } from "@/components/ui/Amount";
import { Button, buttonVariants } from "@/components/ui/button";
import type { ChartConfig } from "@/components/ui/chart";
import { AreaLineChartBase } from "@/components/ui/charts/area-line-chart-base";
import DataLoadError from "@/components/ui/DataLoadError";
import { Link } from "@/components/ui/Link";
import { SectionEmpty } from "@/components/ui/RuledSection";
import { Skeleton } from "@/components/ui/skeleton";
import { UnconvertedTotalWarning } from "@/components/ui/UnconvertedTotalWarning";
import useAccounts from "@/lib/api/account/useAccounts";
import useNetWorth from "@/lib/api/net-worth/useNetWorth";
import useNetWorthHistory from "@/lib/api/reports/netWorthHistory";
import {
  balanceSheet,
  formatMonthName,
  type NetWorthChange,
  netWorthChanges,
} from "@/lib/home/month-overview";
import { type MemberFilter, memberKeysFor } from "@/lib/household/member-attribution";
import {
  monthlyNetWorthPoints,
  netWorthAxisLabels,
} from "@/lib/reports/net-worth-labels";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useHydrated } from "@/lib/utils/useHydrated";

const FIGURE_CLASS =
  "font-mono text-5xl leading-tight font-medium tracking-tight lg:text-6xl";
const CHART_CLASS = "h-44 lg:h-56";

/** The page's one h1, with how fresh the figures under it are. */
function HeroHeader({ title }: { title: string }) {
  const { data: accountsData } = useAccounts();
  // Freshness is relative to the reader's clock: render it once hydrated.
  const hydrated = useHydrated();

  return (
    <header className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
      <h1
        id="net-worth-heading"
        className="text-foreground text-base font-medium"
      >
        {title}
      </h1>
      {hydrated ? (
        <AccountsFreshness accounts={accountsData?.accounts} />
      ) : null}
    </header>
  );
}

function Change({
  change,
  currency,
  today,
}: {
  change: NetWorthChange;
  currency: string;
  today: Date;
}) {
  const t = useTranslations("homeOverview.net-worth");
  const locale = useLocale();
  const formatAmountText = useFormatCurrency();
  const since = new Date(change.since);

  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <Amount
        value={change.delta}
        currency={currency}
        tone="delta"
        signed
        className="font-mono text-base"
      />
      <span className="text-muted-foreground text-sm">
        {t("since", {
          month: formatMonthName(since, locale, {
            utc: true,
            withYear: since.getUTCFullYear() !== today.getFullYear(),
          }),
        })}
      </span>
    </p>
  );
}

/**
 * Net worth leads the home: the figure, how far it has moved since last
 * month and across the history, what is owned and owed, and the month-closing
 * trend beside it. The history is secondary: if it fails, the figure stands
 * and only the chart's slot says so.
 */
export function NetWorthHero({
  member = null,
}: {
  /** One member's net worth, or Shared's; null for the household's. */
  member?: MemberFilter;
} = {}) {
  const t = useTranslations("homeOverview.net-worth");
  const tSheet = useTranslations("homeOverview.sheet");
  const locale = useLocale();
  const formatAmountText = useFormatCurrency();
  const today = useMemo(() => new Date(), []);
  const netWorth = useNetWorth(undefined, member);
  const memberKeys = memberKeysFor(member);
  const history = useNetWorthHistory(memberKeys ? { memberKeys } : {});

  const points = useMemo(
    () => (history.data ? monthlyNetWorthPoints(history.data.data) : []),
    [history.data],
  );
  const chartData = useMemo(() => {
    const labels = netWorthAxisLabels(
      points.map((point) => point.date),
      locale,
    );
    return points.map((point, index) => ({
      month: labels[index],
      netWorth: point.netWorth,
    }));
  }, [points, locale]);
  const chartConfig = useMemo<ChartConfig>(
    () => ({ netWorth: { label: t("title"), color: "var(--color-chart-1)" } }),
    [t],
  );

  const wrap = (children: ReactNode, busy = false) => (
    <section
      aria-labelledby="net-worth-heading"
      aria-busy={busy || undefined}
      className="flex flex-col gap-4"
    >
      <HeroHeader title={t("title")} />
      {children}
    </section>
  );

  if (netWorth.isPending) {
    return wrap(
      <div
        className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16"
        aria-hidden="true"
      >
        <div className="flex flex-col gap-4">
          <Skeleton className="h-16 w-72 max-w-full" />
          <Skeleton className="h-5 w-64 max-w-full" />
          <Skeleton className="mt-4 h-12 w-80 max-w-full" />
        </div>
        <Skeleton className={CHART_CLASS} />
      </div>,
      true,
    );
  }

  if (netWorth.error) {
    return wrap(
      <DataLoadError
        error={netWorth.error}
        onRetry={() => void netWorth.refetch()}
      />,
    );
  }

  const summary = netWorth.data.netWorth;
  const currency = summary.currencyCode ?? "EUR";
  const sheet = balanceSheet(summary);

  if (sheet.own.length === 0 && sheet.owe.length === 0) {
    return wrap(
      <SectionEmpty
        title={t("empty-title")}
        body={t("empty-body")}
        action={
          <Link
            href="/accounts"
            className={buttonVariants({ variant: "default" })}
          >
            {t("empty-action")}
          </Link>
        }
      />,
    );
  }

  const changes = netWorthChanges(points, summary.netWorth, today);
  const formatMoney = (value: number, digits: number) =>
    formatAmountText(value, currency, {
      maximumFractionDigits: digits,
      ...(digits === 0 ? { notation: "compact" as const } : {}),
    });

  let chart: ReactNode = null;
  if (history.isPending) {
    chart = <Skeleton className={CHART_CLASS} aria-hidden="true" />;
  } else if (history.error) {
    chart = (
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <p>{t("history-error")}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void history.refetch()}
        >
          {t("retry")}
        </Button>
      </div>
    );
  } else if (points.length >= 2) {
    chart = (
      <figure className="min-w-0">
        <figcaption className="sr-only">
          {t("chart-label", {
            from: formatMonthName(new Date(points[0].date), locale, {
              utc: true,
              withYear: true,
            }),
            to: formatMonthName(new Date(points.at(-1)!.date), locale, {
              utc: true,
              withYear: true,
            }),
          })}
        </figcaption>
        <AreaLineChartBase
          data={chartData}
          xKey="month"
          series={[{ key: "netWorth", type: "area" }]}
          config={chartConfig}
          className={CHART_CLASS}
          yFormatter={(value) => formatMoney(value, 0)}
          tooltipValueFormatter={(value) => (
            <span className="font-mono whitespace-nowrap tabular-nums">
              {formatMoney(Number(value), 2)}
            </span>
          )}
        />
      </figure>
    );
  }

  return wrap(
    <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2">
            <Amount
              value={summary.netWorth}
              currency={currency}
              className={FIGURE_CLASS}
            />
            {/* A figure that leaves something out says so beside itself. */}
            <UnconvertedTotalWarning
              unconverted={summary.unconverted}
              currency={currency}
            />
          </p>
          {changes.lastMonth ? (
            <Change
              change={changes.lastMonth}
              currency={currency}
              today={today}
            />
          ) : null}
          {changes.overHistory ? (
            <Change
              change={changes.overHistory}
              currency={currency}
              today={today}
            />
          ) : null}
        </div>
        <dl className="flex flex-wrap gap-x-12 gap-y-4">
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground text-sm">{tSheet("own")}</dt>
            <dd>
              <Amount
                value={sheet.ownTotal}
                currency={currency}
                className="font-mono text-lg"
              />
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground text-sm">{tSheet("owe")}</dt>
            <dd>
              <Amount
                value={sheet.oweTotal}
                currency={currency}
                className="font-mono text-lg"
              />
            </dd>
          </div>
        </dl>
      </div>
      {chart}
    </div>,
  );
}

"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Line } from "recharts";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import type { ChartConfig } from "@/components/ui/chart";
import { AreaLineChartBase, useChartFormatters } from "@/components/ui/charts";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Typography";
import { getApiErrorMessage, isDemoReadOnlyError } from "@/lib/api/errors";
import {
  useDeleteHoldingPriceOverride,
  useHoldingPriceHistory,
  useHoldingPriceOnDay,
  useSaveHoldingPriceOverride,
} from "@/lib/api/portfolio/useHoldingPriceOverrides";
import type { PortfolioHolding } from "@/lib/api/portfolio/usePortfoliosHoldings";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import { getManualPriceDates, isIsoCalendarDate, parsePositivePrice, toHoldingPriceChartRows } from "./holding-price-utils";

type Props = { holding: PortfolioHolding; enabled: boolean };

/**
 * A security's daily prices, with the household's manual prices marked, and the form to set,
 * change or remove a manual price for a day. Prices are in the security's own currency, which
 * the price history reports (the holding's figures are in the viewer's currency).
 */
export function HoldingPriceHistory({ holding, enabled }: Props) {
  const t = useTranslations();
  const locale = useLocale();
  const formatCurrency = useFormatCurrency();
  const { formatCompactCurrency } = useChartFormatters();
  const financialAssetKey = holding.financialAssetKey;
  const history = useHoldingPriceHistory(financialAssetKey, enabled);
  const save = useSaveHoldingPriceOverride();
  const remove = useDeleteHoldingPriceOverride();

  const [open, setOpen] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [date, setDate] = useState(utcToday);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [demoBlocked, setDemoBlocked] = useState(false);

  const validDate = isIsoCalendarDate(date);
  const day = useHoldingPriceOnDay(financialAssetKey, date, open && validDate);
  const currency = history.data?.currency ?? null;
  const points = useMemo(() => history.data?.prices ?? [], [history.data?.prices]);
  const chartRows = useMemo(() => toHoldingPriceChartRows(points), [points]);
  const manualDates = useMemo(() => getManualPriceDates(points), [points]);
  const manualPoints = points.filter((point) => point.source === "manual");
  const editing = manualDates.has(date);
  // Until the member types a note, show the one saved for the day.
  const noteValue = note ?? day.data?.override?.note ?? "";
  const priceNumber = parsePositivePrice(price);
  const canSave = validDate && priceNumber !== null && currency !== null && !demoBlocked;
  // Prices are for calendar days, so they are formatted in UTC, never shifted by the viewer's zone.
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }), [locale]);
  const axisFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }), [locale]);
  const formatDay = (value: string) => dateFormatter.format(new Date(`${value}T00:00:00Z`));
  const chartConfig: ChartConfig = {
    manual: { color: "var(--chart-2)", label: t("holding-price-chart-manual") },
    price: { color: "var(--chart-1)", label: t("holding-price-chart-market") },
  };

  function selectDate(nextDate: string) {
    setDate(nextDate);
    const existing = points.find((point) => point.date === nextDate && point.source === "manual");
    if (existing) setPrice(String(existing.price));
    setNote(null);
  }

  function openForm(nextDate = utcToday()) {
    setPrice("");
    selectDate(nextDate);
    setError("");
    setDemoBlocked(false);
    setOpen(true);
  }

  function handleFailure(cause: unknown, fallback: string) {
    if (isDemoReadOnlyError(cause)) setDemoBlocked(true);
    setError(getApiErrorMessage(cause) ?? fallback);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || currency === null || priceNumber === null) return;
    setError("");
    try {
      await save.mutateAsync({ currency, date, financialAssetKey, note: noteValue.trim() || undefined, price: priceNumber });
      setOpen(false);
    } catch (cause) {
      handleFailure(cause, t("holding-price-save-error"));
    }
  }

  async function confirmRemove() {
    setError("");
    try {
      await remove.mutateAsync({ date, financialAssetKey });
      setOpen(false);
    } catch (cause) {
      handleFailure(cause, t("holding-price-delete-error"));
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="holding-price-history-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Text as="h3" id="holding-price-history-title" className="text-sm font-medium">{t("holding-price-history")}</Text>
        {currency ? (
          <Button type="button" variant="secondary" className="min-h-11" onClick={() => openForm()}>{t("holding-price-set")}</Button>
        ) : null}
      </div>

      {history.isLoading ? (
        <div className="flex h-24 items-center justify-center"><Spinner /></div>
      ) : history.isError ? (
        <p className="text-muted-foreground text-sm">{t("holding-price-history-error")}</p>
      ) : (
        <>
          {currency === null ? <p className="text-muted-foreground text-sm">{t("holding-price-no-currency")}</p> : null}
          {points.length ? (
            <>
              <AreaLineChartBase
                data={chartRows}
                xKey="date"
                series={[{ key: "price", type: "line", strokeWidth: 2 }]}
                config={chartConfig}
                showArea={false}
                className="h-[200px]"
                xFormatter={(value) => axisFormatter.format(new Date(`${String(value)}T00:00:00Z`))}
                yFormatter={(value) => formatCompactCurrency(value, currency ?? undefined)}
                tooltipValueFormatter={(value) => formatCurrency(Number(value), currency ?? undefined)}
              >
                {/* Markers only: the manual series is null except on manual days. */}
                <Line
                  dataKey="manual"
                  stroke="none"
                  isAnimationActive={false}
                  dot={{ fill: "var(--background)", r: 4, stroke: "var(--color-manual)", strokeWidth: 2 }}
                  activeDot={{ fill: "var(--background)", r: 5, stroke: "var(--color-manual)", strokeWidth: 2 }}
                />
              </AreaLineChartBase>
              {manualPoints.length ? (
                <>
                  <p className="text-muted-foreground flex items-center gap-2 text-xs">
                    <ManualMarker />
                    {t("holding-price-manual-legend")}
                  </p>
                  <ul className="space-y-1 text-sm">
                    {manualPoints.map((point) => (
                      <li key={point.date} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <ManualMarker />
                          {formatDay(point.date)}
                          <span className="text-muted-foreground">{t("holding-price-manual")}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <Amount value={point.price} currency={currency ?? undefined} />
                          <Button type="button" variant="ghost" className="min-h-11" onClick={() => openForm(point.date)}>{t("edit")}</Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">{t("holding-price-history-empty")}</p>
          )}
        </>
      )}

      {currency ? (
        <DrawerDialog
          open={open}
          onOpenChange={setOpen}
          title={editing ? t("holding-price-edit-title") : t("holding-price-set-title")}
          description={t("holding-price-form-description", { currency })}
          contentClassName="max-w-lg"
        >
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="holding-price-date">{t("holding-price-date")}</Label>
              <Input id="holding-price-date" type="date" max={utcTomorrow()} value={date} onChange={(event) => selectDate(event.target.value)} required />
            </div>
            {day.data?.source === "manual" && !day.data.override ? (
              <p className="text-muted-foreground text-sm">{t("holding-price-inherited-manual")}</p>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="holding-price-value">{t("holding-price-value", { currency })}</Label>
              <Input
                id="holding-price-value"
                className="font-mono"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                aria-invalid={Boolean(price) && priceNumber === null}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="holding-price-note">{t("holding-price-note")}</Label>
              <Input id="holding-price-note" maxLength={500} value={noteValue} onChange={(event) => setNote(event.target.value)} />
            </div>
            {error ? <p role="alert" className="text-destructive-text text-sm">{error}</p> : null}
            {demoBlocked ? <p className="text-muted-foreground text-sm">{t("holding-price-demo-readonly")}</p> : null}
            <div className="flex flex-wrap justify-between gap-2 pt-2">
              {editing ? (
                <Button type="button" variant="destructive" className="min-h-11" disabled={demoBlocked} loading={remove.isPending} onClick={() => setConfirmingRemove(true)}>
                  {t("holding-price-remove")}
                </Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button type="button" variant="secondary" className="min-h-11" onClick={() => setOpen(false)}>{t("cancel")}</Button>
                <Button type="submit" className="min-h-11" disabled={!canSave} loading={save.isPending}>{t("holding-price-save")}</Button>
              </div>
            </div>
          </form>
        </DrawerDialog>
      ) : null}

      <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("holding-price-delete-title", { date: validDate ? formatDay(date) : date })}</AlertDialogTitle>
            <AlertDialogDescription>{t("holding-price-delete-description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmRemove()}>{t("holding-price-delete-confirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ManualMarker() {
  return <span aria-hidden="true" className="border-chart-2 inline-block size-2.5 rounded-full border-2" />;
}

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

/** The API accepts up to tomorrow in UTC, so a member ahead of UTC can set today's price. */
function utcTomorrow() {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

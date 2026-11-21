import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "@/components/shared/charts";
import { useTranslations } from "@/lib/reactTranslations";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorInput from "./CalculatorInput";
import {
  FIRE_MAX_YEARS,
  FIRE_RETURN_MAX,
  FIRE_RETURN_MIN,
  FIRE_SPENDING_CUT,
  FIRE_WITHDRAWAL_RATE_MAX,
  FIRE_WITHDRAWAL_RATE_MIN,
  FIRE_WORKED_EXAMPLE,
  calculateFire,
  fireTargetYear,
  toMonthIndex,
  withSpendingCut,
  type FireInputs,
} from "@/lib/calculators/fire";
import {
  formatFireDuration,
  formatFireProgress,
  formatFireRate as rate,
} from "@/lib/calculators/fireFormat";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatPercent } from "@/lib/numberFormat";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

const noSubscription = () => () => {};

export default function FireCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <FireCalculatorContent />
    </ReactTranslationsProvider>
  );
}

function FireCalculatorContent() {
  const { t, locale } = useTranslations();
  const k = (key: string) => `tools.fire.${key}`;
  const money = (value: number) => formatMoney(locale, value);

  const [inputs, setInputs] = useState<FireInputs>({ ...FIRE_WORKED_EXAMPLE });

  // The target year depends on today's date, which the prerendered page cannot know:
  // it renders without the year and the browser fills it in.
  const startMonth = useSyncExternalStore(
    noSubscription,
    () => toMonthIndex(new Date()),
    () => null,
  );

  // One "tool_used" event per page view, on the visitor's first edit. It carries
  // no figures: what people type stays in the browser.
  const reportedUse = useRef(false);
  const update = (field: keyof FireInputs) => (value: number) => {
    if (!reportedUse.current) {
      reportedUse.current = true;
      pushGtmEvent({ event: "tool_used", tool: "fire", page_type: getPageType() });
    }
    setInputs((previous) => ({ ...previous, [field]: value }));
  };

  const result = useMemo(() => calculateFire(inputs), [inputs]);
  const cutResult = useMemo(() => calculateFire(withSpendingCut(inputs)), [inputs]);
  const used = result.inputs;
  // The 10% line shows wherever the cut gives an answer: a date, or "already covered".
  const showCut =
    result.status !== "reached" &&
    result.status !== "noSpending" &&
    (cutResult.status === "reached" || (cutResult.status === "projected" && cutResult.monthsToTarget !== null));

  const clampedNote = (field: "realReturn" | "withdrawalRate") =>
    Number.isFinite(inputs[field]) && inputs[field] !== used[field]
      ? ` ${t(k("clampedNote"), { value: rate(locale, used[field]) })}`
      : "";

  // An empty rate gives no figures: the calculation would read it as 0% or the default.
  const missingRate = !Number.isFinite(inputs.realReturn) || !Number.isFinite(inputs.withdrawalRate);
  const emptyMessage =
    result.status === "noSpending" ? t(k("noSpending")) : missingRate ? t(k("missingRate")) : null;

  const progressForBar = result.progress === null ? 0 : Math.min(100, result.progress);
  const showChart = emptyMessage === null && result.path.length > 1;

  return (
    <div className="space-y-8">
      <CalculatorLayout>
        {/* Inputs */}
        <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
          <CalculatorInput
            id="fireAnnualSpending"
            label={t(k("annualSpending"))}
            value={inputs.annualSpending}
            onChange={update("annualSpending")}
            min={0}
            step={1000}
            prefix={"€"}
            helpText={t(k("annualSpendingHelp"))}
          />
          <CalculatorInput
            id="fireCurrentAssets"
            label={t(k("currentAssets"))}
            value={inputs.currentAssets}
            onChange={update("currentAssets")}
            min={0}
            step={1000}
            prefix={"€"}
            helpText={t(k("currentAssetsHelp"))}
          />
          <CalculatorInput
            id="fireMonthlyContribution"
            label={t(k("monthlyContribution"))}
            value={inputs.monthlyContribution}
            onChange={update("monthlyContribution")}
            min={0}
            step={50}
            prefix={"€"}
            helpText={t(k("monthlyContributionHelp"))}
          />
          <CalculatorInput
            id="fireRealReturn"
            label={t(k("realReturn"))}
            value={inputs.realReturn}
            onChange={update("realReturn")}
            min={FIRE_RETURN_MIN}
            max={FIRE_RETURN_MAX}
            step={0.5}
            suffix="%"
            helpText={
              t(k("realReturnHelp"), {
                min: rate(locale, FIRE_RETURN_MIN),
                max: rate(locale, FIRE_RETURN_MAX),
              }) + clampedNote("realReturn")
            }
          />
          <CalculatorInput
            id="fireWithdrawalRate"
            label={t(k("withdrawalRate"))}
            value={inputs.withdrawalRate}
            onChange={update("withdrawalRate")}
            min={FIRE_WITHDRAWAL_RATE_MIN}
            max={FIRE_WITHDRAWAL_RATE_MAX}
            step={0.1}
            suffix="%"
            helpText={
              t(k("withdrawalRateHelp"), {
                min: rate(locale, FIRE_WITHDRAWAL_RATE_MIN),
                max: rate(locale, FIRE_WITHDRAWAL_RATE_MAX),
              }) + clampedNote("withdrawalRate")
            }
          />
        </div>

        {/* Results */}
        <div className="sticky top-20 space-y-6 break-words rounded-card border border-border bg-background p-6 shadow-sm lg:top-24">
          <div aria-live="polite" className="space-y-6">
            {emptyMessage !== null ? (
              <p className="rounded-lg border border-border bg-paper-2 px-4 py-3 text-sm text-foreground">
                {emptyMessage}
              </p>
            ) : (
              <>
                <div>
                  <p className="text-sm text-muted-foreground">{t(k("fireNumber"))}</p>
                  <p className="font-mono text-3xl font-bold text-primary">{money(result.fireNumber)}</p>
                  <p className="mt-1 font-mono text-sm text-muted-foreground">
                    {t(k("fireNumberFormula"), {
                      spending: money(used.annualSpending),
                      rate: rate(locale, used.withdrawalRate),
                      target: money(result.fireNumber),
                    })}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="text-sm text-muted-foreground">{t(k("progress"))}</p>
                    <p className="font-mono text-xl font-semibold text-foreground">
                      {formatFireProgress(locale, result.progress ?? 0)}
                    </p>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-paper-3" aria-hidden="true">
                    <div
                      className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-500 motion-reduce:transition-none"
                      style={{ transform: `scaleX(${progressForBar / 100})` }}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t(k("progressValue"), {
                      assets: money(used.currentAssets),
                      target: money(result.fireNumber),
                    })}
                  </p>
                </div>

                {result.status === "projected" && result.monthsToTarget !== null && (
                  <dl className="grid grid-cols-2 gap-4 border-t border-border pt-4">
                    <div>
                      <dt className="text-sm text-muted-foreground">{t(k("timeToFire"))}</dt>
                      <dd className="mt-1 text-xl font-semibold text-foreground">
                        {formatFireDuration(locale, result.monthsToTarget)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">{t(k("targetYear"))}</dt>
                      <dd className="mt-1 font-mono text-xl font-semibold text-foreground">
                        {startMonth === null ? "—" : fireTargetYear(startMonth, result.monthsToTarget)}
                      </dd>
                    </div>
                  </dl>
                )}

                {result.status === "reached" && (
                  <p className="rounded-lg border border-success-text/30 bg-success/10 px-4 py-3 text-sm text-foreground">
                    {t(k("reached"), { rate: rate(locale, used.withdrawalRate) })}
                  </p>
                )}
                {result.status === "unreachable" && (
                  <p className="rounded-lg border border-warning-text/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
                    {t(k(used.monthlyContribution > 0 ? "unreachableWithContribution" : "unreachable"))}
                  </p>
                )}
                {result.status === "beyondHorizon" && (
                  <p className="rounded-lg border border-warning-text/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
                    {t(k("beyondHorizon"), { years: FIRE_MAX_YEARS })}
                  </p>
                )}

                {showCut && (
                  <p className="text-sm text-foreground">
                    {t(k(cutResult.status === "reached" ? "sensitivityReached" : "sensitivity"), {
                      cut: formatPercent(locale, FIRE_SPENDING_CUT, { decimals: 0 }),
                      spending: money(cutResult.inputs.annualSpending),
                      target: money(cutResult.fireNumber),
                      time: formatFireDuration(locale, cutResult.monthsToTarget ?? 0),
                    })}
                  </p>
                )}
              </>
            )}
          </div>

          <p className="border-t border-border pt-4 text-sm text-muted-foreground">{t(k("assumptions"))}</p>
        </div>
      </CalculatorLayout>

      {showChart && (
        <div className="rounded-card border border-border bg-background p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-foreground">{t(k("chartTitle"))}</h3>
          <div className="mt-4 h-72 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart data={result.path} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--border))" />
                <XAxis
                  dataKey="year"
                  tick={{ fontSize: 12 }}
                  label={{ value: t(k("chartYear")), position: "insideBottomRight", offset: -5 }}
                />
                <YAxis
                  width={72}
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value: number) => formatMoney(locale, value, { compact: true })}
                />
                <Tooltip
                  labelFormatter={(year) => `${t(k("chartYear"))}: ${year}`}
                  // @ts-expect-error Recharts tooltip types are very broken
                  formatter={(value: number, name: string) => [money(value), name]}
                />
                <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />
                <Area
                  type="monotone"
                  dataKey="assets"
                  name={t(k("chartAssets"))}
                  stroke="oklch(var(--chart-1))"
                  fill="oklch(var(--chart-1) / 0.2)"
                />
                <Line
                  type="monotone"
                  dataKey="contributed"
                  name={t(k("chartContributed"))}
                  stroke="oklch(var(--chart-2))"
                  strokeDasharray="4 4"
                  dot={false}
                />
                <ReferenceLine
                  y={result.fireNumber}
                  ifOverflow="extendDomain"
                  stroke="oklch(var(--foreground))"
                  strokeDasharray="6 4"
                  label={{
                    value: t(k("chartTarget")),
                    position: "insideTopLeft",
                    fill: "oklch(var(--foreground))",
                    fontSize: 12,
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-foreground">{t(k("tableToggle"))}</summary>
            <div className="mt-3 max-h-80 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b border-border text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-normal">{t(k("chartYear"))}</th>
                    <th scope="col" className="py-2 pr-4 text-right font-normal">{t(k("chartAssets"))}</th>
                    <th scope="col" className="py-2 text-right font-normal">{t(k("chartContributed"))}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.path.map((point) => (
                    <tr key={point.year} className="border-b border-border-2">
                      <td className="py-1.5 pr-4 font-mono">{point.year}</td>
                      <td className="py-1.5 pr-4 text-right font-mono">{money(point.assets)}</td>
                      <td className="py-1.5 text-right font-mono">{money(point.contributed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

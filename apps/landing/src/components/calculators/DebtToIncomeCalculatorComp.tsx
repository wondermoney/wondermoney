import { useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useTranslations } from "@/lib/reactTranslations";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorInput from "./CalculatorInput";
import CalculatorResult from "./CalculatorResult";
import {
  DEBT_TO_INCOME_CAUTION_FROM,
  DEBT_TO_INCOME_HIGH_ABOVE,
  DEBT_TO_INCOME_WORKED_EXAMPLE,
  compareDebtScenario,
  type DebtScenario,
  type DebtToIncomeBand,
  type DebtToIncomeResult,
} from "@/lib/calculators/debtToIncome";
import type { Lang } from "@/lib/i18nLocale";
import { formatPercent, toIntlLocale } from "@/lib/numberFormat";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import { cn } from "@/lib/utils";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

type PaymentRow = {
  id: string;
  label: string;
  amount: number;
};

type ScenarioMode = DebtScenario["kind"];

const BAND_FILL: Record<DebtToIncomeBand, string> = {
  healthy: "bg-success",
  caution: "bg-warning",
  high: "bg-destructive",
};

const BAND_TEXT: Record<DebtToIncomeBand, string> = {
  healthy: "text-success-text",
  caution: "text-warning-text",
  high: "text-destructive-text",
};

const BAND_KEY: Record<DebtToIncomeBand, string> = {
  healthy: "Healthy",
  caution: "Caution",
  high: "High",
};

const INPUT_CLASS = cn(
  "w-full rounded-lg border border-input px-3 py-2.5 text-sm",
  "focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring",
  "transition-colors",
);

function toNumber(value: string): number {
  return value === "" ? 0 : Number(value);
}

export default function DebtToIncomeCalculator({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <DebtToIncomeCalculatorContent />
    </ReactTranslationsProvider>
  );
}

function DebtToIncomeCalculatorContent() {
  const { t, locale } = useTranslations();
  const k = (key: string) => `tools.debtToIncome.${key}`;

  const moneyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(toIntlLocale(locale), {
        style: "currency",
        currency: "EUR",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }),
    [locale],
  );

  const [monthlyIncome, setMonthlyIncome] = useState<number>(
    DEBT_TO_INCOME_WORKED_EXAMPLE.monthlyIncome,
  );
  const [rows, setRows] = useState<PaymentRow[]>(() =>
    DEBT_TO_INCOME_WORKED_EXAMPLE.rows.map((row) => ({
      id: row.id,
      label: t(k(`rows.${row.id}`)),
      amount: row.amount,
    })),
  );
  const nextRowNumber = useRef(1);

  const [scenarioMode, setScenarioMode] = useState<ScenarioMode>("change");
  const [changeRowId, setChangeRowId] = useState<string>(
    DEBT_TO_INCOME_WORKED_EXAMPLE.scenario.paymentId,
  );
  const [changeAmount, setChangeAmount] = useState<number>(
    DEBT_TO_INCOME_WORKED_EXAMPLE.scenario.amount,
  );
  const [addAmount, setAddAmount] = useState<number>(250);

  // One "tool_used" event per page view, on the visitor's first edit. It carries
  // no figures: what people type stays in the browser.
  const reportedUse = useRef(false);
  const markUsed = () => {
    if (reportedUse.current) return;
    reportedUse.current = true;
    pushGtmEvent({ event: "tool_used", tool: "debt_to_income", page_type: getPageType() });
  };

  const selectedChangeRow = rows.find((row) => row.id === changeRowId) ?? rows[0];
  const effectiveMode: ScenarioMode = rows.length === 0 ? "add" : scenarioMode;
  const scenario: DebtScenario =
    effectiveMode === "change" && selectedChangeRow
      ? { kind: "change", paymentId: selectedChangeRow.id, amount: changeAmount }
      : { kind: "add", amount: addAmount };

  const comparison = compareDebtScenario(monthlyIncome, rows, scenario);
  const { current } = comparison;

  const formatRatio = (result: DebtToIncomeResult) =>
    result.ratio === null ? "—" : formatPercent(locale, result.ratio);

  const updateRow = (id: string, patch: Partial<PaymentRow>) => {
    markUsed();
    setRows((previous) => previous.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const removeRow = (id: string) => {
    markUsed();
    setRows((previous) => previous.filter((row) => row.id !== id));
  };

  const addRow = () => {
    markUsed();
    const number = nextRowNumber.current++;
    setRows((previous) => [
      ...previous,
      { id: `added-${number}`, label: t(k("newRowLabel")), amount: 0 },
    ]);
  };

  const selectChangeRow = (id: string) => {
    markUsed();
    setChangeRowId(id);
    setChangeAmount(rows.find((row) => row.id === id)?.amount ?? 0);
  };

  const ratioForBar = current.ratio === null ? 0 : Math.max(0, Math.min(100, current.ratio));

  return (
    <CalculatorLayout>
      {/* Inputs */}
      <div className="space-y-6">
        <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
          <CalculatorInput
            id="dtiMonthlyIncome"
            label={t(k("income"))}
            value={monthlyIncome}
            onChange={(value) => {
              markUsed();
              setMonthlyIncome(value);
            }}
            min={0}
            step={50}
            prefix={"€"}
            helpText={t(k("incomeHelp"))}
          />

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-foreground">
              {t(k("paymentsHeading"))}
            </legend>
            <p className="text-xs text-muted-foreground">{t(k("paymentsHelp"))}</p>

            {rows.length === 0 && (
              <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                {t(k("noRows"))}
              </p>
            )}

            <ul className="space-y-2">
              {rows.map((row) => {
                const name = row.label.trim() || t(k("newRowLabel"));
                return (
                  <li key={row.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={row.label}
                      onChange={(e) => updateRow(row.id, { label: e.target.value })}
                      aria-label={t(k("rowNameLabel"))}
                      className={cn(INPUT_CLASS, "min-w-0 flex-1")}
                    />
                    <div className="relative w-32 shrink-0 sm:w-36">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
                        {"€"}
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={10}
                        value={row.amount}
                        onChange={(e) => updateRow(row.id, { amount: toNumber(e.target.value) })}
                        aria-label={t(k("rowAmountLabel"), { name })}
                        className={cn(INPUT_CLASS, "pl-8 font-mono")}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      aria-label={t(k("removeRow"), { name })}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>

            <button
              type="button"
              onClick={addRow}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-input bg-secondary px-4 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t(k("addRow"))}
            </button>
          </fieldset>
        </div>

        {/* Scenario */}
        <div className="space-y-4 rounded-card border border-border bg-background p-6 shadow-sm">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{t(k("scenarioHeading"))}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t(k("scenarioIntro"))}</p>
          </div>

          <fieldset className="flex flex-col gap-2 sm:flex-row sm:gap-6">
            <legend className="sr-only">{t(k("scenarioHeading"))}</legend>
            {(["change", "add"] as const).map((mode) => (
              <label
                key={mode}
                className={cn(
                  "flex items-center gap-2 text-sm text-foreground",
                  mode === "change" && rows.length === 0 && "opacity-60",
                )}
              >
                <input
                  type="radio"
                  name="dtiScenarioMode"
                  value={mode}
                  checked={effectiveMode === mode}
                  disabled={mode === "change" && rows.length === 0}
                  onChange={() => {
                    markUsed();
                    setScenarioMode(mode);
                  }}
                  className="h-4 w-4 border-input text-primary focus:ring-ring"
                />
                {t(k(mode === "change" ? "scenarioModeChange" : "scenarioModeAdd"))}
              </label>
            ))}
          </fieldset>

          {effectiveMode === "change" && selectedChangeRow ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="dtiScenarioRow" className="block text-sm font-medium text-foreground">
                  {t(k("scenarioPayment"))}
                </label>
                <select
                  id="dtiScenarioRow"
                  value={selectedChangeRow.id}
                  onChange={(e) => selectChangeRow(e.target.value)}
                  className={cn(INPUT_CLASS, "bg-background")}
                >
                  {rows.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.label.trim() || t(k("newRowLabel"))}
                    </option>
                  ))}
                </select>
              </div>
              <CalculatorInput
                id="dtiScenarioChangeAmount"
                label={t(k("scenarioNewAmount"))}
                value={changeAmount}
                onChange={(value) => {
                  markUsed();
                  setChangeAmount(value);
                }}
                min={0}
                step={10}
                prefix={"€"}
              />
            </div>
          ) : (
            <CalculatorInput
              id="dtiScenarioAddAmount"
              label={t(k("scenarioAddAmount"))}
              value={addAmount}
              onChange={(value) => {
                markUsed();
                setAddAmount(value);
              }}
              min={0}
              step={10}
              prefix={"€"}
            />
          )}

          <dl className="grid grid-cols-2 gap-4 break-words">
            <ScenarioFigure
              label={t(k("scenarioCurrent"))}
              value={formatRatio(comparison.current)}
              band={comparison.current.band}
              bandLabel={(band) => t(k(`band${BAND_KEY[band]}`))}
            />
            <ScenarioFigure
              label={t(k("scenarioAfter"))}
              value={formatRatio(comparison.scenario)}
              band={comparison.scenario.band}
              bandLabel={(band) => t(k(`band${BAND_KEY[band]}`))}
            />
          </dl>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {comparison.pointsChange === null
              ? t(k("noIncome"))
              : t(k("scenarioDelta"), {
                  points: new Intl.NumberFormat(toIntlLocale(locale), {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                    signDisplay: "exceptZero",
                  }).format(comparison.pointsChange),
                })}
          </p>
        </div>
      </div>

      {/* Results */}
      <div className="sticky top-20 space-y-6 break-words rounded-card border border-border bg-background p-6 shadow-sm lg:top-24">
        <CalculatorResult
          items={[
            {
              label: t(k("totalPayments")),
              value: moneyFormatter.format(current.totalPayments),
            },
            {
              label: t(k("ratio")),
              value: formatRatio(current),
              highlight: true,
            },
          ]}
        />

        <div aria-live="polite" className="space-y-4">
          {current.status === "noIncome" ? (
            <p className="rounded-lg border border-border bg-paper-2 px-4 py-3 text-sm text-foreground">
              {t(k("noIncome"))}
            </p>
          ) : (
            <>
              <div>
                <p className="text-sm text-muted-foreground">{t(k("arithmeticLabel"))}</p>
                <p className="mt-1 font-mono text-sm text-foreground">
                  {moneyFormatter.format(current.totalPayments)} {"÷"}{" "}
                  {moneyFormatter.format(monthlyIncome)} {"×"} 100 = {formatRatio(current)}
                </p>
              </div>

              <div className="space-y-2">
                <div className="relative h-4 w-full overflow-hidden rounded-full bg-paper-3">
                  <div
                    className={`h-full w-full origin-left rounded-full transition-transform duration-500 motion-reduce:transition-none ${BAND_FILL[current.band]}`}
                    style={{ transform: `scaleX(${ratioForBar / 100})` }}
                  />
                  <div
                    className="absolute top-0 h-full w-0.5 bg-muted-foreground"
                    style={{ left: `${DEBT_TO_INCOME_CAUTION_FROM}%` }}
                    aria-hidden="true"
                  />
                  <div
                    className="absolute top-0 h-full w-0.5 bg-muted-foreground"
                    style={{ left: `${DEBT_TO_INCOME_HIGH_ABOVE}%` }}
                    aria-hidden="true"
                  />
                </div>
                <div className="relative h-4 text-xs text-muted-foreground" aria-hidden="true">
                  <span className="absolute left-0">{formatPercent(locale, 0, { decimals: 0 })}</span>
                  <span
                    className="absolute -translate-x-1/2"
                    style={{ left: `${DEBT_TO_INCOME_CAUTION_FROM}%` }}
                  >
                    {formatPercent(locale, DEBT_TO_INCOME_CAUTION_FROM, { decimals: 0 })}
                  </span>
                  <span
                    className="absolute -translate-x-1/2"
                    style={{ left: `${DEBT_TO_INCOME_HIGH_ABOVE}%` }}
                  >
                    {formatPercent(locale, DEBT_TO_INCOME_HIGH_ABOVE, { decimals: 0 })}
                  </span>
                  <span className="absolute right-0">{formatPercent(locale, 100, { decimals: 0 })}</span>
                </div>
              </div>

              <div>
                <p className={cn("text-base font-semibold", BAND_TEXT[current.band])}>
                  {t(k(`band${BAND_KEY[current.band]}`))}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(k(`band${BAND_KEY[current.band]}Body`))}
                </p>
              </div>

              {current.totalPayments === 0 && (
                <p className="text-sm text-foreground">{t(k("noDebts"))}</p>
              )}

              {current.exceedsIncome ? (
                <p className="rounded-lg border border-destructive-text/30 bg-destructive/10 px-4 py-3 text-sm text-foreground">
                  {t(k("exceedsIncome"), {
                    amount: moneyFormatter.format(Math.abs(current.remainingIncome)),
                  })}
                </p>
              ) : (
                <div>
                  <p className="text-sm text-muted-foreground">{t(k("remainingIncome"))}</p>
                  <p className="font-mono text-xl font-semibold text-foreground">
                    {moneyFormatter.format(current.remainingIncome)}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <p className="border-t border-border pt-4 text-xs text-muted-foreground">
          {t(k("limitsNote"))}
        </p>
      </div>
    </CalculatorLayout>
  );
}

function ScenarioFigure({
  label,
  value,
  band,
  bandLabel,
}: {
  label: string;
  value: string;
  band: DebtToIncomeBand | null;
  bandLabel: (band: DebtToIncomeBand) => string;
}) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-xl font-semibold text-foreground">{value}</dd>
      {band && <dd className={cn("text-sm font-medium", BAND_TEXT[band])}>{bandLabel(band)}</dd>}
    </div>
  );
}

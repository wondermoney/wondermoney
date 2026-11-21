import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "@/components/shared/charts";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorInput from "./CalculatorInput";
import { remainingTerm } from "@/lib/calculators/earlyRepayment";
import {
  MORTGAGE_TRANSFER_EXAMPLE,
  MORTGAGE_TRANSFER_LIMITS,
  computeMortgageTransfer,
  type MortgageTransferField,
  type MortgageTransferResult,
} from "@/lib/calculators/mortgageTransfer";
import { formatFireDuration as formatDuration } from "@/lib/calculators/fireFormat";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { cn } from "@/lib/utils";

const k = (key: string) => `tools.mortgageTransfer.${key}`;

export default function MortgageTransferCalculator({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <MortgageTransferCalculatorContent />
    </ReactTranslationsProvider>
  );
}

type Money = (value: number, decimals?: number) => string;

const LEGEND = "text-sm font-semibold text-foreground";

function MortgageTransferCalculatorContent() {
  const { t, locale } = useTranslations();
  const example = MORTGAGE_TRANSFER_EXAMPLE;

  const [balance, setBalance] = useState<number>(example.balance);
  const [termYears, setTermYears] = useState<number>(example.termYears);
  const [termMonths, setTermMonths] = useState<number>(example.termMonths);
  const [currentRate, setCurrentRate] = useState<number>(example.currentRate);
  const [currentMonthlyFees, setCurrentMonthlyFees] = useState<number>(example.currentMonthlyFees);
  const [newRate, setNewRate] = useState<number>(example.newRate);
  const [newTermYears, setNewTermYears] = useState<number>(example.newTermYears);
  const [newTermMonths, setNewTermMonths] = useState<number>(example.newTermMonths);
  const [newMonthlyFees, setNewMonthlyFees] = useState<number>(example.newMonthlyFees);
  const [exitFeePercent, setExitFeePercent] = useState<number>(example.exitFeePercent);
  const [newLoanFees, setNewLoanFees] = useState<number>(example.newLoanFees);
  const [valuationFee, setValuationFee] = useState<number>(example.valuationFee);
  const [legalFees, setLegalFees] = useState<number>(example.legalFees);

  // The new term starts as the time left and follows it until the visitor sets it.
  const newTermSet = useRef(false);

  const calculation = useMemo(
    () =>
      computeMortgageTransfer({
        balance,
        termYears,
        termMonths,
        currentRate,
        currentMonthlyFees,
        newRate,
        newTermYears,
        newTermMonths,
        newMonthlyFees,
        exitFeePercent,
        newLoanFees,
        valuationFee,
        legalFees,
      }),
    [
      balance,
      termYears,
      termMonths,
      currentRate,
      currentMonthlyFees,
      newRate,
      newTermYears,
      newTermMonths,
      newMonthlyFees,
      exitFeePercent,
      newLoanFees,
      valuationFee,
      legalFees,
    ],
  );

  // Count the first valid edited result, excluding the example shown on page load.
  const edited = useRef(false);
  const usageSent = useRef(false);
  useEffect(() => {
    if (!edited.current || !calculation.ok || usageSent.current) return;
    usageSent.current = true;
    pushGtmEvent({ event: "tool_used", tool: "mortgage_transfer", page_type: getPageType() });
  }, [calculation]);

  const edit = (setter: (value: number) => void) => (value: number) => {
    edited.current = true;
    setter(value);
  };
  const editTimeLeft = (setter: (value: number) => void, follow: (value: number) => void) =>
    edit((value) => {
      setter(value);
      if (!newTermSet.current) follow(value);
    });
  const editNewTerm = (setter: (value: number) => void) =>
    edit((value) => {
      newTermSet.current = true;
      setter(value);
    });

  const money: Money = (value, decimals = 2) => formatMoney(locale, value, { decimals });
  const maxMoney = money(MORTGAGE_TRANSFER_LIMITS.maxBalance, 0);
  const maxFees = money(MORTGAGE_TRANSFER_LIMITS.maxMonthlyFees, 0);
  const maxYears = formatNumber(locale, MORTGAGE_TRANSFER_LIMITS.maxTermYears);
  const maxRate = formatPercent(locale, MORTGAGE_TRANSFER_LIMITS.maxAnnualRate, { decimals: 0 });
  const limits: Record<MortgageTransferField, string> = {
    balance: maxMoney,
    termYears: maxYears,
    termMonths: formatNumber(locale, 11),
    currentRate: maxRate,
    currentMonthlyFees: maxFees,
    newRate: maxRate,
    newTermYears: maxYears,
    newTermMonths: formatNumber(locale, 11),
    newMonthlyFees: maxFees,
    exitFeePercent: formatPercent(locale, MORTGAGE_TRANSFER_LIMITS.maxExitFeePercent, { decimals: 0 }),
    newLoanFees: money(MORTGAGE_TRANSFER_LIMITS.maxCost, 0),
    valuationFee: money(MORTGAGE_TRANSFER_LIMITS.maxCost, 0),
    legalFees: money(MORTGAGE_TRANSFER_LIMITS.maxCost, 0),
  };
  const errorFor = (field: MortgageTransferField): string | undefined => {
    if (calculation.ok) return undefined;
    const error = calculation.errors[field];
    return error
      ? t(k(`errors.${field}.${error}`), {
          max: limits[field],
          min: money(MORTGAGE_TRANSFER_LIMITS.minBalance, 0),
        })
      : undefined;
  };

  const result = calculation.ok ? calculation.result : null;
  const timeLeft = remainingTerm(termYears, termMonths);
  const newTerm = remainingTerm(newTermYears, newTermMonths);
  const roundedNote = (term: { months: number; rounded: boolean }) =>
    term.rounded && term.months > 0 ? (
      <p className="text-xs text-muted-foreground">
        {t(k("termRounded"), { term: formatDuration(locale, term.months) })}
      </p>
    ) : null;

  return (
    <>
      <CalculatorLayout>
        <div className="space-y-8 rounded-card border border-border bg-background p-6 shadow-sm">
          <fieldset className="space-y-5">
            <legend className={LEGEND}>{t(k("current.legend"))}</legend>
            <CalculatorInput
              id="mortgageTransferBalance"
              label={t(k("current.balance"))}
              value={balance}
              onChange={edit(setBalance)}
              min={MORTGAGE_TRANSFER_LIMITS.minBalance}
              max={MORTGAGE_TRANSFER_LIMITS.maxBalance}
              step={1000}
              prefix={"€"}
              helpText={t(k("current.balanceHelp"))}
              error={errorFor("balance")}
            />
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-foreground">{t(k("current.termLabel"))}</legend>
              <div className="grid grid-cols-2 gap-3">
                <CalculatorInput
                  id="mortgageTransferTermYears"
                  label={t(k("termYears"))}
                  value={termYears}
                  onChange={editTimeLeft(setTermYears, setNewTermYears)}
                  min={0}
                  max={MORTGAGE_TRANSFER_LIMITS.maxTermYears}
                  step={1}
                  error={errorFor("termYears")}
                />
                <CalculatorInput
                  id="mortgageTransferTermMonths"
                  label={t(k("termMonths"))}
                  value={termMonths}
                  onChange={editTimeLeft(setTermMonths, setNewTermMonths)}
                  min={0}
                  max={11}
                  step={1}
                  error={errorFor("termMonths")}
                />
              </div>
              <p className="text-xs text-muted-foreground">{t(k("current.termHelp"))}</p>
              {roundedNote(timeLeft)}
            </fieldset>
            <CalculatorInput
              id="mortgageTransferCurrentRate"
              label={t(k("current.rate"))}
              value={currentRate}
              onChange={edit(setCurrentRate)}
              min={0}
              max={MORTGAGE_TRANSFER_LIMITS.maxAnnualRate}
              step={0.05}
              suffix="%"
              helpText={t(k("current.rateHelp"))}
              error={errorFor("currentRate")}
            />
            <CalculatorInput
              id="mortgageTransferCurrentFees"
              label={t(k("current.fees"))}
              value={currentMonthlyFees}
              onChange={edit(setCurrentMonthlyFees)}
              min={0}
              max={MORTGAGE_TRANSFER_LIMITS.maxMonthlyFees}
              step={5}
              prefix={"€"}
              helpText={t(k("current.feesHelp"))}
              error={errorFor("currentMonthlyFees")}
            />
          </fieldset>

          <div className="border-t border-border pt-6">
            <fieldset className="space-y-5">
              <legend className={LEGEND}>{t(k("offer.legend"))}</legend>
              <CalculatorInput
                id="mortgageTransferNewRate"
                label={t(k("offer.rate"))}
                value={newRate}
                onChange={edit(setNewRate)}
                min={0}
                max={MORTGAGE_TRANSFER_LIMITS.maxAnnualRate}
                step={0.05}
                suffix="%"
                helpText={t(k("offer.rateHelp"))}
                error={errorFor("newRate")}
              />
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-foreground">{t(k("offer.termLabel"))}</legend>
                <div className="grid grid-cols-2 gap-3">
                  <CalculatorInput
                    id="mortgageTransferNewTermYears"
                    label={t(k("termYears"))}
                    value={newTermYears}
                    onChange={editNewTerm(setNewTermYears)}
                    min={0}
                    max={MORTGAGE_TRANSFER_LIMITS.maxTermYears}
                    step={1}
                    error={errorFor("newTermYears")}
                  />
                  <CalculatorInput
                    id="mortgageTransferNewTermMonths"
                    label={t(k("termMonths"))}
                    value={newTermMonths}
                    onChange={editNewTerm(setNewTermMonths)}
                    min={0}
                    max={11}
                    step={1}
                    error={errorFor("newTermMonths")}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{t(k("offer.termHelp"))}</p>
                {roundedNote(newTerm)}
              </fieldset>
              <CalculatorInput
                id="mortgageTransferNewFees"
                label={t(k("offer.fees"))}
                value={newMonthlyFees}
                onChange={edit(setNewMonthlyFees)}
                min={0}
                max={MORTGAGE_TRANSFER_LIMITS.maxMonthlyFees}
                step={5}
                prefix={"€"}
                helpText={t(k("offer.feesHelp"))}
                error={errorFor("newMonthlyFees")}
              />
            </fieldset>
          </div>

          <div className="border-t border-border pt-6">
            <fieldset className="space-y-5">
              <legend className={LEGEND}>{t(k("costs.legend"))}</legend>
              <p className="text-xs text-muted-foreground">{t(k("costs.help"))}</p>
              <CalculatorInput
                id="mortgageTransferExitFee"
                label={t(k("costs.exitFee"))}
                value={exitFeePercent}
                onChange={edit(setExitFeePercent)}
                min={0}
                max={MORTGAGE_TRANSFER_LIMITS.maxExitFeePercent}
                step={0.1}
                suffix="%"
                helpText={t(k("costs.exitFeeHelp"))}
                error={errorFor("exitFeePercent")}
              />
              <CalculatorInput
                id="mortgageTransferNewLoanFees"
                label={t(k("costs.newLoanFees"))}
                value={newLoanFees}
                onChange={edit(setNewLoanFees)}
                min={0}
                max={MORTGAGE_TRANSFER_LIMITS.maxCost}
                step={50}
                prefix={"€"}
                helpText={t(k("costs.newLoanFeesHelp"))}
                error={errorFor("newLoanFees")}
              />
              <CalculatorInput
                id="mortgageTransferValuationFee"
                label={t(k("costs.valuationFee"))}
                value={valuationFee}
                onChange={edit(setValuationFee)}
                min={0}
                max={MORTGAGE_TRANSFER_LIMITS.maxCost}
                step={50}
                prefix={"€"}
                error={errorFor("valuationFee")}
              />
              <CalculatorInput
                id="mortgageTransferLegalFees"
                label={t(k("costs.legalFees"))}
                value={legalFees}
                onChange={edit(setLegalFees)}
                min={0}
                max={MORTGAGE_TRANSFER_LIMITS.maxCost}
                step={50}
                prefix={"€"}
                helpText={t(k("costs.legalFeesHelp"))}
                error={errorFor("legalFees")}
              />
            </fieldset>
          </div>
        </div>

        <div className="min-w-0 space-y-6 rounded-card border border-border bg-background p-6 shadow-sm lg:sticky lg:top-24">
          {result ? (
            <Results result={result} money={money} />
          ) : (
            <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>
          )}
        </div>
      </CalculatorLayout>

      {result && <Comparison result={result} money={money} />}
    </>
  );
}

function Results({ result, money }: { result: MortgageTransferResult; money: Money }) {
  const { t, locale } = useTranslations();
  const duration = (months: number) => formatDuration(locale, months);
  const { breakEven, monthlySaving, netSaving, longerTerm, costs } = result;
  const loss = netSaving < 0;

  const monthlyChange =
    monthlySaving > 0
      ? t(k("results.lessEachMonth"), { amount: money(monthlySaving) })
      : monthlySaving < 0
        ? t(k("results.moreEachMonth"), { amount: money(-monthlySaving) })
        : t(k("results.sameEachMonth"));

  let breakEvenText: string;
  if (breakEven.kind === "noCosts") breakEvenText = t(k("results.breakEvenNoCosts"));
  else if (breakEven.kind === "never") breakEvenText = t(k("results.breakEvenNever"));
  else if (loss && longerTerm) {
    // Covered early by the lower payment, then overtaken by the extra years of the longer term.
    breakEvenText = t(k("results.breakEvenThenLoss"), { month: formatNumber(locale, breakEven.month) });
  } else {
    breakEvenText = t(k("results.breakEven"), {
      month: formatNumber(locale, breakEven.month),
      duration: duration(breakEven.month),
    });
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <MonthlyFigure label={t(k("results.currentMonthly"))} value={money(result.current.monthlyTotal)} />
        <MonthlyFigure label={t(k("results.offerMonthly"))} value={money(result.offer.monthlyTotal)} />
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">{t(k("results.includesFees"))}</p>
      <p className="text-sm font-medium text-foreground">{monthlyChange}</p>

      <div className="border-t-2 border-primary/30 pt-4">
        <p className="text-sm text-muted-foreground">{t(k(loss ? "results.netCost" : "results.netSaving"))}</p>
        <p
          className={cn(
            "break-words font-mono text-2xl font-bold",
            loss ? "text-destructive-text" : "text-primary",
          )}
        >
          {money(Math.abs(netSaving))}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t(k("results.netSavingHelp"))}</p>
      </div>

      <div className="rounded-lg bg-paper-2 px-4 py-3">
        <p className="text-sm font-semibold text-foreground">{t(k("results.breakEvenTitle"))}</p>
        <p className="mt-1 text-sm text-foreground">{breakEvenText}</p>
      </div>

      {longerTerm && (
        <p className="rounded-lg bg-warning/10 px-4 py-3 text-sm text-foreground" role="note">
          {longerTerm.extraInterest > 0
            ? t(k("results.longerTerm"), {
                extra: duration(longerTerm.extraMonths),
                sameTerm: money(longerTerm.sameTermMonthlyTotal),
                interest: money(longerTerm.extraInterest),
              })
            : t(k("results.longerTermNoInterest"), { extra: duration(longerTerm.extraMonths) })}
        </p>
      )}
      {loss && !longerTerm && (
        <p className="text-sm text-destructive-text">{t(k("results.costsExceed"))}</p>
      )}

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-border pt-4 text-sm sm:grid-cols-2">
        <SummaryItem label={t(k("costs.exitFee"))} value={money(costs.exitFee)} />
        <SummaryItem label={t(k("costs.newLoanFees"))} value={money(costs.newLoanFees)} />
        <SummaryItem label={t(k("costs.valuationFee"))} value={money(costs.valuationFee)} />
        <SummaryItem label={t(k("costs.legalFees"))} value={money(costs.legalFees)} />
        <SummaryItem label={t(k("results.switchingCosts"))} value={money(costs.total)} strong />
      </dl>
    </>
  );
}

function MonthlyFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="break-words font-mono text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function SummaryItem({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex min-w-0 flex-wrap justify-between gap-x-3">
      <dt className={strong ? "font-medium text-foreground" : "text-muted-foreground"}>{label}</dt>
      <dd className={cn("break-words font-mono text-foreground", strong && "font-semibold")}>{value}</dd>
    </div>
  );
}

function Comparison({ result, money }: { result: MortgageTransferResult; money: Money }) {
  const { t } = useTranslations();
  return (
    <section className="mt-10 space-y-6" aria-labelledby="mortgage-transfer-comparison">
      <h2
        id="mortgage-transfer-comparison"
        className="text-2xl font-semibold tracking-tight text-foreground"
      >
        {t(k("table.title"))}
      </h2>
      <ComparisonTable result={result} money={money} />
      <p className="text-xs text-muted-foreground">{t(k("resultNote"))}</p>

      <h2 id="mortgage-transfer-savings" className="pt-4 text-2xl font-semibold tracking-tight text-foreground">
        {t(k("chart.title"))}
      </h2>
      <p className="max-w-3xl text-muted-foreground">{t(k("chart.description"))}</p>
      <SavingsChart result={result} money={money} />
      <YearTable result={result} money={money} />
    </section>
  );
}

function ComparisonTable({ result, money }: { result: MortgageTransferResult; money: Money }) {
  const { t, locale } = useTranslations();
  const duration = (months: number) => formatDuration(locale, months);
  const columns = [
    { key: "current", loan: result.current, switching: 0 },
    { key: "offer", loan: result.offer, switching: result.costs.total },
  ] as const;

  // Durations are words, so only the money rows use Geist Mono.
  const rows: Array<{
    label: string;
    words?: boolean;
    strong?: boolean;
    cell: (column: (typeof columns)[number]) => string;
  }> = [
    { label: t(k("table.monthlyPayment")), cell: ({ loan }) => money(loan.monthlyPayment) },
    { label: t(k("table.monthlyFees")), cell: ({ loan }) => money(loan.monthlyFees) },
    { label: t(k("table.monthlyTotal")), cell: ({ loan }) => money(loan.monthlyTotal) },
    { label: t(k("table.term")), words: true, cell: ({ loan }) => duration(loan.months) },
    { label: t(k("table.totalInterest")), cell: ({ loan }) => money(loan.totalInterest) },
    { label: t(k("table.totalFees")), cell: ({ loan }) => money(loan.totalFees) },
    { label: t(k("table.switchingCosts")), cell: ({ switching }) => money(switching) },
    { label: t(k("table.totalCost")), strong: true, cell: ({ loan }) => money(loan.totalCost) },
  ];

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[32rem] text-sm">
        <caption className="sr-only">{t(k("table.caption"))}</caption>
        <thead className="bg-paper-2 text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              <span className="sr-only">{t(k("table.figure"))}</span>
            </th>
            {columns.map((column) => (
              <th key={column.key} scope="col" className="px-3 py-2 text-right font-medium">
                {t(k(`table.${column.key}`))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-border-2">
              <th
                scope="row"
                className={cn(
                  "px-3 py-2 text-left",
                  row.strong ? "font-medium text-foreground" : "font-normal text-muted-foreground",
                )}
              >
                {row.label}
              </th>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "whitespace-nowrap px-3 py-2 text-right text-foreground",
                    !row.words && "font-mono",
                    row.strong && "font-semibold",
                  )}
                >
                  {row.cell(column)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SavingsChart({ result, money }: { result: MortgageTransferResult; money: Money }) {
  const { t, locale } = useTranslations();
  const duration = (months: number) => formatDuration(locale, months);
  // A numeric year axis, so the break-even month and a loan's last month sit where they fall.
  const data = result.points.map((point) => ({
    years: point.month / 12,
    saved: point.cumulativeSaving,
  }));
  const lastYear = Math.ceil(Math.max(result.current.months, result.offer.months) / 12);
  const step = lastYear > 20 ? 5 : lastYear > 8 ? 2 : 1;
  const ticks = Array.from({ length: Math.floor(lastYear / step) + 1 }, (_, index) => index * step);

  return (
    <div className="h-64 w-full min-w-0" role="img" aria-label={t(k("chart.label"))}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--border))" />
          <XAxis
            dataKey="years"
            type="number"
            domain={[0, "dataMax"]}
            ticks={ticks}
            label={{ value: t(k("chart.year")), position: "insideBottomRight", offset: -5 }}
            tick={{ fontSize: 12 }}
          />
          <YAxis
            tickFormatter={(value: number) => formatMoney(locale, value, { compact: true })}
            tick={{ fontSize: 12 }}
            width={64}
          />
          <Tooltip
            // @ts-expect-error Recharts tooltip types are very broken
            formatter={(value: number, name: string) => [money(value, 0), name]}
            labelFormatter={(years) =>
              typeof years === "number" ? duration(Math.round(years * 12)) : years
            }
          />
          <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />
          {result.costs.total > 0 && (
            <ReferenceLine
              y={result.costs.total}
              stroke="oklch(var(--chart-2))"
              strokeDasharray="4 4"
              strokeWidth={2}
              ifOverflow="extendDomain"
            />
          )}
          <ReferenceLine y={0} stroke="oklch(var(--input))" />
          <Line
            type="linear"
            dataKey="saved"
            name={t(k("chart.saved"))}
            stroke="oklch(var(--chart-1))"
            strokeWidth={2}
            dot={false}
          />
          {result.costs.total > 0 && (
            // An empty series so the legend names the dashed costs line.
            <Line
              dataKey="costs"
              name={t(k("chart.costs"))}
              stroke="oklch(var(--chart-2))"
              strokeDasharray="4 4"
              strokeWidth={2}
              dot={false}
              legendType="plainline"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The chart's figures as a table, year by year. */
function YearTable({ result, money }: { result: MortgageTransferResult; money: Money }) {
  const { t, locale } = useTranslations();
  const signed = (value: number) => formatMoney(locale, value, { decimals: 2, sign: "always" });
  const cell = "whitespace-nowrap px-3 py-2 text-right font-mono text-foreground";

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[32rem] text-sm">
        <caption className="px-3 py-2 text-left text-sm font-medium text-foreground">
          {t(k("yearTable.caption"))}
        </caption>
        <thead className="bg-paper-2 text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              {t(k("yearTable.year"))}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t(k("yearTable.saving"))}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t(k("yearTable.cumulative"))}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t(k("yearTable.afterCosts"))}
            </th>
          </tr>
        </thead>
        <tbody>
          {result.years.map((year) => (
            <tr key={year.year} className="border-t border-border-2">
              <th scope="row" className="px-3 py-2 text-left font-normal text-muted-foreground">
                {t(k("yearTable.yearLabel"), { year: formatNumber(locale, year.year) })}
              </th>
              <td className={cell}>{signed(year.saving)}</td>
              <td className={cell}>{money(year.cumulativeSaving)}</td>
              <td className={cn(cell, year.afterCosts < 0 && "text-destructive-text")}>
                {signed(year.afterCosts)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

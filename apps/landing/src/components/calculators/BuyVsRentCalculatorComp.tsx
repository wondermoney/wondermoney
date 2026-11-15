import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorInput from "./CalculatorInput";
import CalculatorResult from "./CalculatorResult";
import {
  BUY_VS_RENT_EXAMPLE,
  BUY_VS_RENT_LIMITS,
  computeBuyVsRent,
  type BuyVsRentField,
  type BuyVsRentInput,
  type BuyVsRentYear,
} from "@/lib/calculators/buyVsRent";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";

export default function BuyVsRentCalculator({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <BuyVsRentCalculatorContent />
    </ReactTranslationsProvider>
  );
}

type FieldConfig = {
  field: BuyVsRentField;
  step: number;
  min?: number;
  max?: number;
  unit: "money" | "percent" | "years";
  help?: boolean;
};

const L = BUY_VS_RENT_LIMITS;

const GROUPS: { key: string; fields: FieldConfig[] }[] = [
  {
    key: "home",
    fields: [
      { field: "homePrice", step: 5000, min: 0, max: L.maxHomePrice, unit: "money" },
      { field: "downPayment", step: 1000, min: 0, max: L.maxHomePrice, unit: "money", help: true },
      { field: "purchaseCostsPct", step: 0.5, min: 0, max: L.maxPurchaseCostsPct, unit: "percent", help: true },
      { field: "ownershipCostsPct", step: 0.1, min: 0, max: L.maxOwnershipCostsPct, unit: "percent", help: true },
      { field: "appreciationPct", step: 0.5, min: L.minGrowthPct, max: L.maxGrowthPct, unit: "percent", help: true },
      { field: "sellingCostsPct", step: 0.5, min: 0, max: L.maxSellingCostsPct, unit: "percent", help: true },
    ],
  },
  {
    key: "mortgage",
    fields: [
      { field: "mortgageRate", step: 0.05, min: 0, max: L.maxMortgageRate, unit: "percent", help: true },
      { field: "mortgageTermYears", step: 1, min: 1, max: L.maxTermYears, unit: "years" },
    ],
  },
  {
    key: "renting",
    fields: [
      { field: "monthlyRent", step: 50, min: 0, max: L.maxMonthlyRent, unit: "money" },
      { field: "rentIncreasePct", step: 0.5, min: L.minGrowthPct, max: L.maxGrowthPct, unit: "percent", help: true },
    ],
  },
  {
    key: "comparison",
    fields: [
      { field: "investmentReturnPct", step: 0.5, min: L.minGrowthPct, max: L.maxGrowthPct, unit: "percent", help: true },
      { field: "horizonYears", step: 1, min: 1, max: L.maxHorizonYears, unit: "years", help: true },
    ],
  },
];

function BuyVsRentCalculatorContent() {
  const { t, locale } = useTranslations();
  const k = (key: string) => `tools.buyVsRent.${key}`;

  const [input, setInput] = useState<BuyVsRentInput>({ ...BUY_VS_RENT_EXAMPLE });
  const calculation = useMemo(() => computeBuyVsRent(input), [input]);

  // The shared landing tool event: one `tool_used` per page view, on the visitor's first edit,
  // without amounts. pushGtmEvent drops it unless analytics consent was given.
  const usageSent = useRef(false);
  const edit = (field: BuyVsRentField) => (value: number) => {
    if (!usageSent.current) {
      usageSent.current = true;
      pushGtmEvent({ event: "tool_used", tool: "buy_vs_rent", page_type: getPageType() });
    }
    setInput((current) => ({ ...current, [field]: value }));
  };

  const money = (value: number, decimals = 2) => formatMoney(locale, value, { decimals });
  const percent = (value: number) => formatPercent(locale, value, { decimals: 0 });

  const limitText = (config: FieldConfig, bound: number | undefined) => {
    if (bound === undefined) return "";
    if (config.unit === "money") return money(bound, 0);
    if (config.unit === "percent") return percent(bound);
    return formatNumber(locale, bound);
  };
  const errorFor = (config: FieldConfig): string | undefined => {
    if (calculation.ok) return undefined;
    const error = calculation.errors[config.field];
    if (!error) return undefined;
    return t(k(`errors.${error}`), {
      min: limitText(config, config.min),
      max: limitText(config, config.max),
      minLoan: money(L.minLoanAmount, 0),
    });
  };

  const result = calculation.ok ? calculation.result : null;
  const horizon = result ? result.years.length - 1 : Math.round(input.horizonYears);

  const chartData = useMemo(
    () =>
      result?.years.map((year) => ({
        year: year.year,
        buy: Math.round(year.ownerNetWorth),
        rent: Math.round(year.renterNetWorth),
      })) ?? [],
    [result],
  );

  let verdictLabel = t(k("results.even"));
  if (result && result.difference > 0) verdictLabel = t(k("results.buyAhead"));
  if (result && result.difference < 0) verdictLabel = t(k("results.rentAhead"));

  return (
    <>
      <CalculatorLayout>
        {/* Inputs */}
        <div className="space-y-8 rounded-card border border-border bg-background p-6 shadow-sm">
          {GROUPS.map((group) => (
            <fieldset key={group.key} className="space-y-5">
              <legend className="mb-4 text-base font-semibold text-foreground">
                {t(k(`groups.${group.key}`))}
              </legend>
              {group.fields.map((config) => (
                <CalculatorInput
                  key={config.field}
                  id={`buyVsRent-${config.field}`}
                  label={t(k(`fields.${config.field}.label`))}
                  value={input[config.field]}
                  onChange={edit(config.field)}
                  min={config.min}
                  max={config.max}
                  step={config.step}
                  prefix={config.unit === "money" ? "€" : undefined}
                  suffix={
                    config.unit === "percent" ? "%" : config.unit === "years" ? t(k("years")) : undefined
                  }
                  helpText={config.help ? t(k(`fields.${config.field}.help`)) : undefined}
                  error={errorFor(config)}
                />
              ))}
            </fieldset>
          ))}
        </div>

        {/* Results */}
        <div className="space-y-6 rounded-card border border-border bg-background p-6 shadow-sm lg:sticky lg:top-24">
          {result ? (
            <>
              <CalculatorResult
                items={[
                  {
                    label: t(k("results.ownerNetWorth"), { years: horizon }),
                    value: money(result.ownerNetWorth),
                  },
                  {
                    label: t(k("results.renterNetWorth"), { years: horizon }),
                    value: money(result.renterNetWorth),
                  },
                  {
                    label: verdictLabel,
                    value: money(Math.abs(result.difference)),
                    highlight: true,
                  },
                ]}
              />
              <p className="text-sm font-medium text-foreground">
                {result.breakEvenYear === null
                  ? t(k("results.noBreakEven"), { years: horizon })
                  : t(k("results.breakEven"), { year: result.breakEvenYear })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(k("results.firstMonth"), {
                  owning: money(result.firstMonthOwnerCost),
                  mortgage: money(result.monthlyMortgagePayment),
                  rent: money(result.firstMonthRent),
                  upfront: money(result.upfrontCash),
                })}
              </p>

              <div
                className="h-72 w-full min-w-0"
                role="img"
                aria-label={t(k("chartLabel"), { years: horizon })}
              >
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--border))" />
                    <XAxis
                      dataKey="year"
                      label={{ value: t(k("year")), position: "insideBottomRight", offset: -5 }}
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis
                      tickFormatter={(v: number) => formatMoney(locale, v, { compact: true })}
                      tick={{ fontSize: 12 }}
                      width={64}
                    />
                    <Tooltip
                      // @ts-expect-error Recharts tooltip types are very broken
                      formatter={(value: number, name: string) => [money(value, 0), name]}
                      labelFormatter={(label) =>
                        Number(label) === 0
                          ? t(k("table.start"))
                          : t(k("table.yearLabel"), { year: String(label) })
                      }
                    />
                    <Legend
                      formatter={(value) => <span className="text-foreground">{value}</span>}
                    />
                    <Line
                      type="monotone"
                      dataKey="buy"
                      name={t(k("chartBuy"))}
                      stroke="oklch(var(--chart-1))"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="rent"
                      name={t(k("chartRent"))}
                      stroke="oklch(var(--chart-2))"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>
          )}
        </div>
      </CalculatorLayout>

      {result && <YearTable years={result.years} money={money} />}
    </>
  );
}

function YearTable({
  years,
  money,
}: {
  years: BuyVsRentYear[];
  money: (value: number) => string;
}) {
  const { t, locale } = useTranslations();
  const k = (key: string) => `tools.buyVsRent.table.${key}`;
  const cell = "px-3 py-2 text-right font-mono whitespace-nowrap";
  const head = (children: ReactNode) => (
    <th scope="col" className="px-3 py-2 text-right font-medium">
      {children}
    </th>
  );

  return (
    <section className="mt-10" aria-labelledby="buy-vs-rent-table-title">
      <h2
        id="buy-vs-rent-table-title"
        className="text-2xl font-semibold tracking-tight text-foreground"
      >
        {t(k("title"))}
      </h2>
      <p className="mt-2 max-w-3xl text-muted-foreground">{t(k("description"))}</p>

      <div className="mt-6 overflow-x-auto rounded-card border border-border">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="bg-paper-2 text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                {t(k("year"))}
              </th>
              {head(t(k("homeValue")))}
              {head(t(k("loanBalance")))}
              {head(t(k("ownerNetWorth")))}
              {head(t(k("renterNetWorth")))}
              {head(t(k("difference")))}
            </tr>
          </thead>
          <tbody>
            {years.map((year) => (
              <tr key={year.year} className="border-t border-border">
                <th scope="row" className="px-3 py-2 text-left font-medium text-foreground">
                  {year.year === 0 ? t(k("start")) : t(k("yearLabel"), { year: year.year })}
                </th>
                <td className={cell}>{money(year.homeValue)}</td>
                <td className={cell}>{money(year.loanBalance)}</td>
                <td className={cell}>{money(year.ownerNetWorth)}</td>
                <td className={cell}>{money(year.renterNetWorth)}</td>
                <td className={cell}>
                  {formatMoney(locale, year.difference, { decimals: 2, sign: "always" })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

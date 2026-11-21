import { useMemo, useRef, useState } from "react";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorInput from "./CalculatorInput";
import CalculatorResult from "./CalculatorResult";
import {
  BORROWING_CAPACITY_EXAMPLE,
  BORROWING_CAPACITY_LIMITS,
  computeBorrowingCapacity,
  type BorrowingCapacityField,
  type BorrowingCapacityInput,
  type BorrowingCapacityResult,
} from "@/lib/calculators/borrowingCapacity";
import { classifyDebtToIncome } from "@/lib/calculators/debtToIncome";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { toLocalizedPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

export default function BorrowingCapacityCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <BorrowingCapacityCalculatorContent />
    </ReactTranslationsProvider>
  );
}

type Translate = ReturnType<typeof useTranslations>["t"];
type Format = (value: number) => string;
type OkResult = Extract<BorrowingCapacityResult, { status: "ok" }>;

const k = (key: string) => `tools.borrowingCapacity.${key}`;
const LIMITS = BORROWING_CAPACITY_LIMITS;

const BAND_KEY = {
  healthy: "tools.debtToIncome.bandHealthy",
  caution: "tools.debtToIncome.bandCaution",
  high: "tools.debtToIncome.bandHigh",
} as const;

function BorrowingCapacityCalculatorContent() {
  const { t, locale } = useTranslations();

  const [input, setInput] = useState<BorrowingCapacityInput>({ ...BORROWING_CAPACITY_EXAMPLE });
  const calculation = useMemo(() => computeBorrowingCapacity(input), [input]);

  // The shared landing tool event: one `tool_used` per page view, on the visitor's first edit,
  // without amounts. pushGtmEvent drops it unless analytics consent was given.
  const usageSent = useRef(false);
  const edit = (field: BorrowingCapacityField) => (value: number) => {
    if (!usageSent.current) {
      usageSent.current = true;
      pushGtmEvent({ event: "tool_used", tool: "borrowing_capacity", page_type: getPageType() });
    }
    setInput((current) => ({ ...current, [field]: value }));
  };

  // Figures in the result always show cents, so they add up on screen; prose rounds to euros.
  const exact: Format = (value) => formatMoney(locale, value, { decimals: 2 });
  const euros: Format = (value) => formatMoney(locale, value, { decimals: 0 });
  const pct: Format = (value) =>
    formatPercent(locale, value, {
      decimals: Number.isInteger(value) ? 0 : Number.isInteger(value * 10) ? 1 : 2,
    });

  const limitValues: Record<BorrowingCapacityField, { min?: string; max: string }> = {
    monthlyIncome: { max: euros(LIMITS.maxMonthlyAmount) },
    existingPayments: { max: euros(LIMITS.maxMonthlyAmount) },
    maxDebtShare: { min: pct(LIMITS.minDebtShare), max: pct(LIMITS.maxDebtShare) },
    annualRate: { max: pct(LIMITS.maxAnnualRate) },
    termYears: { max: formatNumber(locale, LIMITS.maxTermYears) },
    savings: { max: euros(LIMITS.maxSavings) },
    purchaseCostsRate: { max: pct(LIMITS.maxPurchaseCostsRate) },
    maxLoanToValue: { min: pct(LIMITS.minLoanToValue), max: pct(LIMITS.maxLoanToValue) },
  };
  const errorFor = (field: BorrowingCapacityField): string | undefined => {
    if (calculation.ok) return undefined;
    const error = calculation.errors[field];
    return error ? t(k(`errors.${field}.${error}`), limitValues[field]) : undefined;
  };

  const shareBand = Number.isFinite(input.maxDebtShare)
    ? classifyDebtToIncome(input.maxDebtShare)
    : null;

  const field = (
    id: BorrowingCapacityField,
    props: { step: number; min?: number; max?: number; prefix?: string; suffix?: string },
    helpText?: string,
  ) => (
    <CalculatorInput
      id={`borrowingCapacity-${id}`}
      label={t(k(id))}
      value={input[id]}
      onChange={edit(id)}
      min={props.min ?? 0}
      max={props.max}
      step={props.step}
      prefix={props.prefix}
      suffix={props.suffix}
      helpText={helpText}
      error={errorFor(id)}
    />
  );

  const result = calculation.ok ? calculation.result : null;

  return (
    <>
      <CalculatorLayout>
        {/* Inputs */}
        <div className="space-y-8 rounded-card border border-border bg-background p-6 shadow-sm">
          <fieldset className="space-y-5">
            <legend className="mb-1 text-base font-semibold text-foreground">
              {t(k("budgetHeading"))}
            </legend>
            {field(
              "monthlyIncome",
              { step: 100, max: LIMITS.maxMonthlyAmount, prefix: "€" },
              t(k("monthlyIncomeHelp")),
            )}
            {field(
              "existingPayments",
              { step: 25, max: LIMITS.maxMonthlyAmount, prefix: "€" },
              t(k("existingPaymentsHelp")),
            )}
            {field(
              "maxDebtShare",
              { step: 1, min: LIMITS.minDebtShare, max: LIMITS.maxDebtShare, suffix: "%" },
              [
                t(k("maxDebtShareHelp"), limitValues.maxDebtShare),
                shareBand
                  ? t(k("maxDebtShareBand"), {
                      share: pct(input.maxDebtShare),
                      band: t(BAND_KEY[shareBand]),
                    })
                  : "",
              ]
                .filter(Boolean)
                .join(" "),
            )}
          </fieldset>

          <fieldset className="space-y-5">
            <legend className="mb-1 text-base font-semibold text-foreground">
              {t(k("loanHeading"))}
            </legend>
            {field(
              "annualRate",
              { step: 0.05, max: LIMITS.maxAnnualRate, suffix: "%" },
              t(k("annualRateHelp")),
            )}
            {field("termYears", { step: 1, min: 1, max: LIMITS.maxTermYears, suffix: t(k("years")) })}
          </fieldset>

          <fieldset className="space-y-5">
            <legend className="mb-1 text-base font-semibold text-foreground">
              {t(k("savingsHeading"))}
            </legend>
            {field(
              "savings",
              { step: 1000, max: LIMITS.maxSavings, prefix: "€" },
              t(k("savingsHelp")),
            )}
            {field(
              "purchaseCostsRate",
              { step: 0.5, max: LIMITS.maxPurchaseCostsRate, suffix: "%" },
              t(k("purchaseCostsRateHelp"), {
                rate: pct(BORROWING_CAPACITY_EXAMPLE.purchaseCostsRate),
              }),
            )}
            {field(
              "maxLoanToValue",
              {
                step: 5,
                min: LIMITS.minLoanToValue,
                max: LIMITS.maxLoanToValue,
                suffix: "%",
              },
              t(k("maxLoanToValueHelp"), {
                rate: pct(BORROWING_CAPACITY_EXAMPLE.maxLoanToValue),
              }),
            )}
          </fieldset>
        </div>

        {/* Result */}
        <div className="space-y-6 rounded-card border border-border bg-background p-6 shadow-sm lg:sticky lg:top-24">
          {result?.status === "ok" ? (
            <ResultPanel result={result} input={input} exact={exact} euros={euros} pct={pct} />
          ) : (
            <p className="text-sm leading-6 text-muted-foreground" aria-live="polite">
              {result?.status === "outOfRange"
                ? t(k("status.outOfRange"), { max: euros(LIMITS.maxLoanAmount) })
                : t(k("errors.summary"))}
            </p>
          )}
          <p className="border-t border-border pt-4 text-sm leading-6 text-muted-foreground">
            {t(k("lenderNote"))}
          </p>
        </div>
      </CalculatorLayout>

      {result && (
        <TwoLimits
          result={result}
          input={input}
          exact={exact}
          pct={pct}
        />
      )}
    </>
  );
}

function yearsLabel(t: Translate, locale: Lang, years: number): string {
  return years === 1
    ? t(k("yearsOne"))
    : t(k("yearsCount"), {
        count: formatNumber(locale, years, Number.isInteger(years) ? 0 : 1),
      });
}

function ResultPanel({
  result,
  input,
  exact,
  euros,
  pct,
}: {
  result: OkResult;
  input: BorrowingCapacityInput;
  exact: Format;
  euros: Format;
  pct: Format;
}) {
  const { t, locale } = useTranslations();
  const { monthly, cash, mortgage, debtToIncome, lift } = result;

  const items = [
    { label: t(k("result.price")), value: exact(result.price), highlight: true },
    { label: t(k("result.loan")), value: exact(result.loan) },
    { label: t(k("result.downPayment")), value: exact(result.downPayment) },
    { label: t(k("result.purchaseCosts")), value: exact(result.purchaseCosts) },
    ...(mortgage
      ? [
          {
            label: t(k("result.monthlyPayment"), {
              rate: pct(input.annualRate),
              years: yearsLabel(t, locale, input.termYears),
            }),
            value: exact(mortgage.monthlyPayment),
          },
        ]
      : []),
  ];

  const status = (() => {
    if (result.price === 0) {
      if (!monthly.hasRoom && cash.savings === 0) return t(k("status.nothing"));
      return t(k("status.noSavings"), { deposit: pct(cash.depositShare), costs: pct(cash.purchaseCostsRate) });
    }
    if (!monthly.hasRoom) {
      return t(k("status.noRoom"), {
        share: pct(input.maxDebtShare),
        min: euros(BORROWING_CAPACITY_LIMITS.minLoanAmount),
      });
    }
    if (result.loan === 0) {
      return t(k("status.savingsOnly"), { min: euros(BORROWING_CAPACITY_LIMITS.minLoanAmount) });
    }
    return t(k(`binding.${result.binding}`));
  })();

  const liftLine = (() => {
    // No lift: both limits meet, or the raise would go past what the calculator takes.
    if (!lift) return result.binding === "both" && result.price > 0 ? t(k("lift.both")) : null;
    switch (lift.kind) {
      case "income":
        return t(k("lift.income"), { amount: euros(lift.extraMonthlyIncome), price: euros(lift.price) });
      case "incomeStep":
        return t(k("lift.incomeStep"), { step: euros(lift.step), amount: euros(lift.priceIncrease) });
      case "savings":
        return t(k("lift.savings"), { amount: euros(lift.extraSavings), price: euros(lift.price) });
      case "incomeToBorrow":
        return t(k("lift.incomeToBorrow"), {
          amount: euros(lift.extraMonthlyIncome),
          min: euros(BORROWING_CAPACITY_LIMITS.minLoanAmount),
        });
    }
  })();

  return (
    <div className="space-y-5">
      <CalculatorResult items={result.price > 0 ? items : items.slice(0, 1)} />
      <div aria-live="polite" className="space-y-2 rounded-md bg-muted px-4 py-3 text-sm leading-6">
        <p className={cn("font-medium", result.price === 0 ? "text-warning-text" : "text-foreground")}>
          {status}
        </p>
        {liftLine && <p className="text-foreground">{liftLine}</p>}
      </div>
      {mortgage && (
        <dl className="grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm">
          <div>
            <dt className="text-muted-foreground">{t(k("result.totalInterest"))}</dt>
            <dd className="font-mono text-foreground">{exact(mortgage.totalInterest)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t(k("result.totalPaid"))}</dt>
            <dd className="font-mono text-foreground">{exact(mortgage.totalPaid)}</dd>
          </div>
        </dl>
      )}
      {debtToIncome.status === "ok" && (
        <p className="text-sm leading-6 text-foreground">
          {t(k(mortgage ? "result.debtToIncome" : "result.debtToIncomeCurrent"), {
            ratio: formatPercent(locale, debtToIncome.ratio),
            band: t(BAND_KEY[debtToIncome.band]),
          })}
        </p>
      )}
      {mortgage && (
        <a
          href={toLocalizedPath("toolMortgage", locale)}
          className="inline-block text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80"
        >
          {t(k("result.scheduleLink"))}
        </a>
      )}
    </div>
  );
}

function TwoLimits({
  result,
  input,
  exact,
  pct,
}: {
  result: BorrowingCapacityResult;
  input: BorrowingCapacityInput;
  exact: Format;
  pct: Format;
}) {
  const { t, locale } = useTranslations();
  const { monthly, cash } = result;
  const binding = result.status === "ok" ? result.binding : null;
  const rate = input.annualRate;

  const badge = (limit: "monthly" | "cash") =>
    binding === limit || binding === "both" ? (
      <span className="rounded-sm bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
        {t(k("limits.setsLimit"))}
      </span>
    ) : null;

  const row = (label: string, value: string, strong = false) => (
    <div className="flex items-baseline justify-between gap-4 border-t border-border-2 py-2 first:border-t-0">
      <dt className={strong ? "font-medium text-foreground" : "text-muted-foreground"}>{label}</dt>
      <dd className={cn("whitespace-nowrap font-mono", strong ? "font-semibold text-foreground" : "text-foreground")}>
        {value}
      </dd>
    </div>
  );

  return (
    <section className="mt-10" aria-labelledby="borrowing-capacity-limits-title">
      <h2
        id="borrowing-capacity-limits-title"
        className="text-2xl font-semibold tracking-tight text-foreground"
      >
        {t(k("limits.title"))}
      </h2>
      <p className="mt-2 max-w-3xl text-muted-foreground">{t(k("limits.intro"))}</p>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="rounded-card border border-border p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-foreground">{t(k("limits.monthlyTitle"))}</h3>
            {badge("monthly")}
          </div>
          <dl className="mt-4 text-sm">
            {row(
              t(k("limits.allowed"), { share: pct(input.maxDebtShare) }),
              exact(monthly.allowedPayments),
            )}
            {row(t(k("limits.existing")), `− ${exact(monthly.existingPayments)}`)}
            {row(t(k("limits.room")), exact(monthly.maxNewPayment))}
            {row(
              t(k("limits.maxLoan"), { rate: pct(rate), years: yearsLabel(t, locale, input.termYears) }),
              exact(monthly.maxLoan),
            )}
            {row(t(k("limits.monthlyPrice")), exact(monthly.priceCeiling), true)}
          </dl>
          {!monthly.hasRoom && (
            <p className="mt-3 text-sm leading-6 text-warning-text">
              {t(k("limits.noRoom"), {
                min: formatMoney(locale, BORROWING_CAPACITY_LIMITS.minLoanAmount, { decimals: 0 }),
              })}
            </p>
          )}
        </div>

        <div className="rounded-card border border-border p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-foreground">{t(k("limits.cashTitle"))}</h3>
            {badge("cash")}
          </div>
          <dl className="mt-4 text-sm">
            {row(t(k("limits.savings")), exact(cash.savings))}
            {row(t(k("limits.deposit"), { ltv: pct(cash.loanToValue) }), pct(cash.depositShare))}
            {row(t(k("limits.costs")), `+ ${pct(cash.purchaseCostsRate)}`)}
            {row(t(k("limits.cashShare")), pct(cash.cashShare))}
            {row(
              t(k("limits.cashPrice")),
              cash.priceCeiling === null ? t(k("limits.noCeiling")) : exact(cash.priceCeiling),
              true,
            )}
          </dl>
          {cash.priceCeiling === null && (
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {t(k("limits.noCeilingNote"))}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorInput from "./CalculatorInput";
import CalculatorResult from "./CalculatorResult";
import {
  RATE_REVISION_EXAMPLE,
  RATE_REVISION_LIMITS,
  RATE_REVISION_STRESS_STEPS,
  computeRateRevision,
  shiftedIndex,
  totalRate,
  type RateRevisionField,
  type RateRevisionInput,
  type RateRevisionResult,
} from "@/lib/calculators/rateRevision";
import {
  DEBT_TO_INCOME_CAUTION_FROM,
  DEBT_TO_INCOME_HIGH_ABOVE,
} from "@/lib/calculators/debtToIncome";
import { remainingTerm } from "@/lib/calculators/earlyRepayment";
import { formatFireDuration as formatDuration } from "@/lib/calculators/fireFormat";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { cn } from "@/lib/utils";

export default function RateRevisionCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <RateRevisionCalculatorContent />
    </ReactTranslationsProvider>
  );
}

const k = (key: string) => `tools.rateRevision.${key}`;
const LIMITS = RATE_REVISION_LIMITS;

const BAND_KEY = {
  healthy: "tools.debtToIncome.bandHealthy",
  caution: "tools.debtToIncome.bandCaution",
  high: "tools.debtToIncome.bandHigh",
} as const;

type Format = (value: number) => string;
type Formats = {
  exact: Format;
  signed: Format;
  rate: Format;
  signedPercent: Format;
  points: Format;
  share: Format;
};

const EXAMPLE_INPUT: RateRevisionInput = {
  balance: RATE_REVISION_EXAMPLE.balance,
  termYears: RATE_REVISION_EXAMPLE.termYears,
  termMonths: RATE_REVISION_EXAMPLE.termMonths,
  indexRate: RATE_REVISION_EXAMPLE.indexRate,
  spread: RATE_REVISION_EXAMPLE.spread,
  newIndexRate: RATE_REVISION_EXAMPLE.newIndexRate,
  monthlyIncome: RATE_REVISION_EXAMPLE.monthlyIncome,
};

/** Up to three decimals, as indices are quoted (2.143%), and none for a whole rate. */
function rateDecimals(value: number): number {
  for (let decimals = 0; decimals < 3; decimals++) {
    const scaled = value * 10 ** decimals;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6) return decimals;
  }
  return 3;
}

function RateRevisionCalculatorContent() {
  const { t, locale } = useTranslations();

  const [input, setInput] = useState<RateRevisionInput>(EXAMPLE_INPUT);
  const calculation = useMemo(() => computeRateRevision(input), [input]);

  // Count the first valid result produced by an edit. The default example and invalid
  // input do not count. The shared tracker applies analytics consent.
  const usageSent = useRef(false);
  useEffect(() => {
    if (input === EXAMPLE_INPUT || !calculation.ok || usageSent.current) return;
    usageSent.current = true;
    pushGtmEvent({ event: "tool_used", tool: "rate_revision", page_type: getPageType() });
  }, [input, calculation.ok]);

  const edit = (field: RateRevisionField) => (value: number) => {
    setInput((current) => ({ ...current, [field]: value }));
  };

  // Result figures show cents, so they add up on screen; limits in messages round to euros.
  const formats: Formats = {
    exact: (value) => formatMoney(locale, value, { decimals: 2 }),
    signed: (value) =>
      formatMoney(locale, value, { decimals: 2, sign: value === 0 ? "auto" : "always" }),
    rate: (value) => formatPercent(locale, value, { decimals: rateDecimals(value) }),
    signedPercent: (value) =>
      formatPercent(locale, value, { decimals: 1, sign: value === 0 ? "auto" : "always" }),
    points: (value) =>
      value === 0 ? formatNumber(locale, 0) : `${value > 0 ? "+" : "−"}${formatNumber(locale, Math.abs(value))}`,
    // A share of income, to one decimal as the debt-to-income calculator rounds it.
    share: (value) => formatPercent(locale, value, { decimals: 1 }),
  };
  const euros: Format = (value) => formatMoney(locale, value, { decimals: 0 });

  const limitValues: Record<RateRevisionField, { min?: string; max?: string }> = {
    balance: { min: euros(LIMITS.minBalance), max: euros(LIMITS.maxBalance) },
    termYears: { max: formatNumber(locale, LIMITS.maxTermYears) },
    termMonths: {},
    indexRate: { min: formats.rate(LIMITS.minIndexRate), max: formats.rate(LIMITS.maxIndexRate) },
    spread: { max: formats.rate(LIMITS.maxSpread) },
    newIndexRate: { min: formats.rate(LIMITS.minIndexRate), max: formats.rate(LIMITS.maxIndexRate) },
    monthlyIncome: { max: euros(LIMITS.maxMonthlyIncome) },
  };
  const errorFor = (field: RateRevisionField): string | undefined => {
    if (calculation.ok) return undefined;
    const error = calculation.errors[field];
    return error ? t(k(`errors.${field}.${error}`), limitValues[field]) : undefined;
  };

  const field = (
    id: RateRevisionField,
    props: { step: number; min?: number; max?: number; prefix?: string; suffix?: string },
    helpText?: string,
  ) => (
    <CalculatorInput
      id={`rateRevision-${id}`}
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

  // The rate lines and stress buttons follow whichever inputs are valid, before the whole form is.
  const errors = calculation.ok ? {} : calculation.errors;
  const indexValid = !errors.indexRate;
  const todayRate =
    indexValid && !errors.spread ? totalRate(input.indexRate, input.spread) : null;
  const newRate =
    !errors.newIndexRate && !errors.spread ? totalRate(input.newIndexRate, input.spread) : null;
  const term = remainingTerm(input.termYears, input.termMonths);

  const result = calculation.ok ? calculation.result : null;

  return (
    <>
      <CalculatorLayout>
        {/* Inputs */}
        <div className="space-y-8 rounded-card border border-border bg-background p-6 shadow-sm">
          <fieldset className="space-y-5">
            <legend className="mb-1 text-base font-semibold text-foreground">{t(k("loanHeading"))}</legend>
            {field(
              "balance",
              { step: 1000, min: LIMITS.minBalance, max: LIMITS.maxBalance, prefix: "€" },
              t(k("balanceHelp")),
            )}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-foreground">{t(k("termLabel"))}</legend>
              <div className="grid grid-cols-2 gap-3">
                <CalculatorInput
                  id="rateRevision-termYears"
                  label={t(k("termYears"))}
                  value={input.termYears}
                  onChange={edit("termYears")}
                  min={0}
                  max={LIMITS.maxTermYears}
                  step={1}
                  error={errorFor("termYears")}
                />
                <CalculatorInput
                  id="rateRevision-termMonths"
                  label={t(k("termMonths"))}
                  value={input.termMonths}
                  onChange={edit("termMonths")}
                  min={0}
                  max={11}
                  step={1}
                  error={errorFor("termMonths")}
                />
              </div>
              <p className="text-xs text-muted-foreground">{t(k("termHelp"))}</p>
              {term.rounded && term.months > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t(k("termRounded"), { term: formatDuration(locale, term.months) })}
                </p>
              )}
            </fieldset>
            {field(
              "indexRate",
              { step: 0.05, min: LIMITS.minIndexRate, max: LIMITS.maxIndexRate, suffix: "%" },
              t(k("indexRateHelp")),
            )}
            {field("spread", { step: 0.05, max: LIMITS.maxSpread, suffix: "%" }, t(k("spreadHelp")))}
            {todayRate && (
              <p className="text-sm text-foreground" aria-live="polite">
                {t(k("currentRate"), { rate: formats.rate(todayRate.rate) })}
                {todayRate.floored && <span className="text-muted-foreground"> {t(k("floored"))}</span>}
              </p>
            )}
          </fieldset>

          <fieldset className="space-y-5">
            <legend className="mb-1 text-base font-semibold text-foreground">
              {t(k("revisionHeading"))}
            </legend>
            {field(
              "newIndexRate",
              { step: 0.05, min: LIMITS.minIndexRate, max: LIMITS.maxIndexRate, suffix: "%" },
              t(k("newIndexRateHelp")),
            )}
            <div className="space-y-2">
              <p id="rateRevision-stressLabel" className="text-sm font-medium text-foreground">
                {t(k("stressLabel"))}
              </p>
              <div role="group" aria-labelledby="rateRevision-stressLabel" className="flex flex-wrap gap-2">
                {RATE_REVISION_STRESS_STEPS.map((step) => {
                  // A step that would take the index out of range is not offered.
                  const shifted = indexValid ? shiftedIndex(input.indexRate, step) : null;
                  const target =
                    shifted !== null && shifted >= LIMITS.minIndexRate && shifted <= LIMITS.maxIndexRate
                      ? shifted
                      : null;
                  const active = target !== null && target === input.newIndexRate;
                  return (
                    <button
                      key={step}
                      type="button"
                      disabled={target === null}
                      aria-pressed={active}
                      onClick={() => target !== null && edit("newIndexRate")(target)}
                      className={cn(
                        "h-9 rounded-md border px-3 text-sm font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                        active
                          ? "border-primary/60 bg-primary/10 text-primary"
                          : "border-input bg-background text-foreground hover:bg-accent",
                      )}
                    >
                      {t(k(Math.abs(step) === 1 ? "stress.one" : "stress.other"), {
                        change: formats.points(step),
                      })}
                    </button>
                  );
                })}
              </div>
            </div>
            {newRate && (
              <p className="text-sm text-foreground" aria-live="polite">
                {t(k("newRate"), { rate: formats.rate(newRate.rate) })}
                {newRate.floored && <span className="text-muted-foreground"> {t(k("floored"))}</span>}
              </p>
            )}
          </fieldset>

          <fieldset className="space-y-5">
            <legend className="mb-1 text-base font-semibold text-foreground">{t(k("incomeHeading"))}</legend>
            {field(
              "monthlyIncome",
              { step: 100, max: LIMITS.maxMonthlyIncome, prefix: "€" },
              t(k("monthlyIncomeHelp")),
            )}
          </fieldset>
        </div>

        {/* Result */}
        <div className="min-w-0 space-y-6 rounded-card border border-border bg-background p-6 shadow-sm lg:sticky lg:top-24">
          {result ? (
            <ResultPanel result={result} formats={formats} />
          ) : (
            <p className="text-sm leading-6 text-muted-foreground" aria-live="polite">
              {t(k("errors.summary"))}
            </p>
          )}
          <p className="border-t border-border pt-4 text-sm leading-6 text-muted-foreground">
            {t(k("assumptionNote"))}
          </p>
        </div>
      </CalculatorLayout>

      {result && <ScenarioTable result={result} formats={formats} />}
    </>
  );
}

function ResultPanel({ result, formats }: { result: RateRevisionResult; formats: Formats }) {
  const { t } = useTranslations();
  const { exact, signed, rate, signedPercent } = formats;
  const { current, revised, monthlyChange, nextYear, income } = result;

  const direction = monthlyChange > 0 ? "up" : monthlyChange < 0 ? "down" : "same";
  const changeTone =
    direction === "up" ? "text-destructive-text" : direction === "down" ? "text-success-text" : "text-foreground";

  const nextYearLabel =
    nextYear.payments === 12
      ? t(k("result.nextYear"))
      : nextYear.payments === 1
        ? t(k("result.paymentLeft"))
        : t(k("result.paymentsLeft"), { count: nextYear.payments });

  return (
    <div className="space-y-5">
      <div>
        <CalculatorResult
          items={[
            {
              label: t(k("result.currentPayment"), { rate: rate(current.rate) }),
              value: exact(current.monthlyPayment),
            },
            {
              label: t(k("result.revisedPayment"), { rate: rate(revised.rate) }),
              value: exact(revised.monthlyPayment),
              highlight: true,
            },
          ]}
        />
        <p className={cn("mt-1 text-sm font-medium", changeTone)} aria-live="polite">
          {direction === "same"
            ? t(k("result.same"))
            : t(k(`result.${direction}`), {
                amount: exact(Math.abs(monthlyChange)),
                percent: signedPercent(result.monthlyChangePercent),
              })}
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-4 border-t border-border pt-4 text-sm sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-muted-foreground">{t(k("result.monthlyChange"))}</dt>
          <dd className="break-words font-mono text-foreground">{signed(monthlyChange)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">{nextYearLabel}</dt>
          <dd className="break-words font-mono text-foreground">{signed(nextYear.change)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">{t(k("result.totalInterest"))}</dt>
          <dd className="break-words font-mono text-foreground">{signed(result.totalInterestChange)}</dd>
        </div>
      </dl>

      {income && income.current.status === "ok" && income.revised.status === "ok" && (
        <div className="space-y-2 rounded-md bg-muted px-4 py-3 text-sm leading-6">
          <p className="text-foreground">
            {t(k("result.incomeShare"), {
              revised: formats.share(income.revised.ratio),
              band: t(BAND_KEY[income.revised.band]),
              current: formats.share(income.current.ratio),
            })}
          </p>
          {income.revised.exceedsIncome && (
            <p className="font-medium text-warning-text">{t(k("result.exceedsIncome"))}</p>
          )}
          <p className="text-muted-foreground">
            {t(k("result.bandNote"), {
              caution: DEBT_TO_INCOME_CAUTION_FROM,
              high: DEBT_TO_INCOME_HIGH_ABOVE,
            })}
          </p>
        </div>
      )}
    </div>
  );
}

function ScenarioTable({ result, formats }: { result: RateRevisionResult; formats: Formats }) {
  const { t } = useTranslations();
  const { exact, signed, rate, points } = formats;

  return (
    <section className="mt-10 space-y-4" aria-labelledby="rate-revision-table">
      <h2 id="rate-revision-table" className="text-2xl font-semibold tracking-tight text-foreground">
        {t(k("table.title"))}
      </h2>
      <p className="max-w-3xl text-muted-foreground">{t(k("table.intro"))}</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">{t(k("table.caption"))}</caption>
          <thead className="bg-paper-2 text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">{t(k("table.change"))}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("table.index"))}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("table.rate"))}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("table.payment"))}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("table.monthlyChange"))}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("table.interestChange"))}</th>
            </tr>
          </thead>
          <tbody>
            {result.scenarios.map((row) => {
              const isToday = row.step === 0;
              const isRevised = !isToday && row.indexRate === result.revised.indexRate;
              return (
                <tr
                  key={row.step}
                  className={cn("border-t border-border-2", (isToday || isRevised) && "bg-primary/5")}
                >
                  <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-normal text-foreground">
                    {isToday
                      ? t(k("table.today"))
                      : t(k(Math.abs(row.step) === 1 ? "stress.one" : "stress.other"), {
                          change: points(row.step),
                        })}
                    {isRevised && (
                      <span className="ml-2 rounded-sm bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        {t(k("table.selected"))}
                      </span>
                    )}
                  </th>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">
                    {rate(row.indexRate)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">
                    {rate(row.rate)}
                    {row.floored && <span aria-hidden="true">*</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold text-foreground">
                    {exact(row.monthlyPayment)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">
                    {signed(row.monthlyChange)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">
                    {signed(row.totalInterestChange)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {result.scenarios.some((row) => row.floored) && (
        <p className="text-xs text-muted-foreground">* {t(k("floored"))}</p>
      )}
    </section>
  );
}

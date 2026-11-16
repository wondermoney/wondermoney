import { useId, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorInput from "./CalculatorInput";
import CalculatorResult from "./CalculatorResult";
import {
  PERSONAL_LOAN_EXAMPLE,
  PERSONAL_LOAN_LIMITS,
  computePersonalLoan,
  maxUpfrontFees,
  type PersonalLoanField,
  type PersonalLoanInput,
  type PersonalLoanResult,
} from "@/lib/calculators/personalLoan";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { cn } from "@/lib/utils";

export default function PersonalLoanCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <PersonalLoanCalculatorContent />
    </ReactTranslationsProvider>
  );
}

type Format = (value: number) => string;

const k = (key: string) => `tools.personalLoan.${key}`;
const LIMITS = PERSONAL_LOAN_LIMITS;

function PersonalLoanCalculatorContent() {
  const { t, locale } = useTranslations();

  const [input, setInput] = useState<PersonalLoanInput>({
    amount: PERSONAL_LOAN_EXAMPLE.amount,
    termMonths: PERSONAL_LOAN_EXAMPLE.termMonths,
    annualRate: PERSONAL_LOAN_EXAMPLE.annualRate,
    upfrontFees: PERSONAL_LOAN_EXAMPLE.upfrontFees,
    monthlyFees: PERSONAL_LOAN_EXAMPLE.monthlyFees,
  });
  const calculation = useMemo(() => computePersonalLoan(input), [input]);

  // The shared landing tool event: one `tool_used` per page view, on the visitor's first edit,
  // without amounts. pushGtmEvent drops it unless analytics consent was given.
  const usageSent = useRef(false);
  const edit = (field: PersonalLoanField) => (value: number) => {
    if (!usageSent.current) {
      usageSent.current = true;
      pushGtmEvent({ event: "tool_used", tool: "personal_loan", page_type: getPageType() });
    }
    setInput((current) => ({ ...current, [field]: value }));
  };

  // Figures in the result always show cents, so they add up on screen.
  const exact: Format = (value) => formatMoney(locale, value, { decimals: 2 });
  const euros: Format = (value) => formatMoney(locale, value, { decimals: 0 });
  const months = (value: number) => formatNumber(locale, value);

  const limitValues: Record<PersonalLoanField, { min?: string; max: string }> = {
    amount: { min: euros(LIMITS.minAmount), max: euros(LIMITS.maxAmount) },
    termMonths: { min: months(LIMITS.minTermMonths), max: months(LIMITS.maxTermMonths) },
    annualRate: { max: formatPercent(locale, LIMITS.maxAnnualRate, { decimals: 0 }) },
    upfrontFees: { max: Number.isFinite(input.amount) ? exact(maxUpfrontFees(input.amount)) : "" },
    monthlyFees: { max: euros(LIMITS.maxMonthlyFees) },
  };
  const errorFor = (field: PersonalLoanField): string | undefined => {
    if (calculation.ok) return undefined;
    const error = calculation.errors[field];
    return error ? t(k(`errors.${field}.${error}`), limitValues[field]) : undefined;
  };

  const field = (
    id: PersonalLoanField,
    props: { step: number; min?: number; max?: number; prefix?: string; suffix?: string },
    helpText?: string,
  ) => (
    <CalculatorInput
      id={`personalLoan-${id}`}
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
        <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
          {field(
            "amount",
            { step: 500, min: LIMITS.minAmount, max: LIMITS.maxAmount, prefix: "€" },
            t(k("amountHelp")),
          )}
          {field(
            "termMonths",
            { step: 6, min: LIMITS.minTermMonths, max: LIMITS.maxTermMonths, suffix: t(k("months")) },
            t(k("termMonthsHelp"), limitValues.termMonths),
          )}
          {field(
            "annualRate",
            { step: 0.1, max: LIMITS.maxAnnualRate, suffix: "%" },
            t(k("annualRateHelp")),
          )}
          {field("upfrontFees", { step: 10, prefix: "€" }, t(k("upfrontFeesHelp")))}
          {field(
            "monthlyFees",
            { step: 1, max: LIMITS.maxMonthlyFees, prefix: "€" },
            t(k("monthlyFeesHelp")),
          )}
        </div>

        {/* Result */}
        <div className="space-y-6 rounded-card border border-border bg-background p-6 shadow-sm lg:sticky lg:top-24">
          {result ? (
            <ResultPanel result={result} exact={exact} />
          ) : (
            <p className="text-sm leading-6 text-muted-foreground" aria-live="polite">
              {t(k("errors.summary"))}
            </p>
          )}
          <p className="border-t border-border pt-4 text-sm leading-6 text-muted-foreground">
            {t(k("estimateNote"))}
          </p>
        </div>
      </CalculatorLayout>

      {result && <Schedule result={result} exact={exact} />}
    </>
  );
}

function ResultPanel({ result, exact }: { result: PersonalLoanResult; exact: Format }) {
  const { t, locale } = useTranslations();
  const hasMonthlyFees = result.totalMonthlyFees > 0;

  const apr =
    result.apr > LIMITS.maxShownApr
      ? t(k("result.aprOver"), { max: formatPercent(locale, LIMITS.maxShownApr, { decimals: 0 }) })
      : formatPercent(locale, result.apr, { decimals: 2 });

  return (
    <div className="space-y-5">
      <div aria-live="polite">
        <p className="text-sm text-muted-foreground">{t(k("result.monthlyPayment"))}</p>
        <p className="font-mono text-3xl font-bold text-primary">{exact(result.monthlyPayment)}</p>
        {hasMonthlyFees && (
          <p className="mt-1 text-sm text-muted-foreground">
            {t(k("result.monthlyPaymentSplit"), {
              loan: exact(result.loanPayment),
              fees: exact(result.schedule[0].fees),
            })}
          </p>
        )}
      </div>
      <CalculatorResult
        items={[
          { label: t(k("result.apr")), value: apr },
          { label: t(k("result.totalInterest")), value: exact(result.totalInterest) },
          { label: t(k("result.totalFees")), value: exact(result.totalFees) },
          { label: t(k("result.totalCostOfCredit")), value: exact(result.totalCostOfCredit) },
          { label: t(k("result.totalRepaid")), value: exact(result.totalRepaid) },
        ]}
      />
      <div className="space-y-2 text-sm leading-6 text-muted-foreground">
        {result.upfrontFees > 0 && (
          <p>{t(k("result.amountReceived"), { amount: exact(result.amountReceived) })}</p>
        )}
        <p>
          {t(k("result.paymentsNote"), {
            count: formatNumber(locale, result.months),
            last: exact(result.lastPayment),
          })}
        </p>
        <p>{t(k("result.aprNote"))}</p>
      </div>
    </div>
  );
}

function Schedule({ result, exact }: { result: PersonalLoanResult; exact: Format }) {
  const { t } = useTranslations();
  const [open, setOpen] = useState(false);
  const tableId = useId();
  const showFees = result.totalMonthlyFees > 0;

  const sum = (pick: (row: PersonalLoanResult["schedule"][number]) => number) =>
    result.schedule.reduce((total, row) => total + Math.round(pick(row) * 100), 0) / 100;

  const cell = "px-3 py-1.5 text-right font-mono whitespace-nowrap";
  const head = "px-3 py-2 text-right font-medium";

  return (
    <section className="mt-10" aria-labelledby="personal-loan-schedule-title">
      <h2
        id="personal-loan-schedule-title"
        className="text-2xl font-semibold tracking-tight text-foreground"
      >
        {t(k("schedule.title"))}
      </h2>
      <p className="mt-2 max-w-3xl text-muted-foreground">{t(k("schedule.description"))}</p>
      {result.upfrontFees > 0 && (
        <p className="mt-2 max-w-3xl text-muted-foreground">
          {t(k("schedule.upfrontNote"), { fees: exact(result.upfrontFees) })}
        </p>
      )}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={open ? tableId : undefined}
        className="mt-4 inline-flex h-10 items-center gap-1.5 rounded-md border border-input bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-paper-3 active:scale-[0.98] motion-reduce:active:scale-100"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        {t(k(open ? "schedule.hide" : "schedule.show"))}
      </button>

      {open && (
        <div id={tableId} className="mt-6 overflow-x-auto rounded-card border border-border">
          <table className="w-full min-w-[36rem] text-sm" aria-labelledby="personal-loan-schedule-title">
            <thead className="bg-paper-2 text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  {t(k("schedule.month"))}
                </th>
                <th scope="col" className={head}>{t(k("schedule.payment"))}</th>
                <th scope="col" className={head}>{t(k("schedule.principal"))}</th>
                <th scope="col" className={head}>{t(k("schedule.interest"))}</th>
                {showFees && <th scope="col" className={head}>{t(k("schedule.fees"))}</th>}
                <th scope="col" className={head}>{t(k("schedule.balance"))}</th>
              </tr>
            </thead>
            <tbody className="text-foreground">
              {result.schedule.map((row) => (
                <tr key={row.month} className="border-t border-border-2">
                  <th scope="row" className="px-3 py-1.5 text-left font-mono font-normal">
                    {row.month}
                  </th>
                  <td className={cell}>{exact(row.payment)}</td>
                  <td className={cell}>{exact(row.principal)}</td>
                  <td className={cell}>{exact(row.interest)}</td>
                  {showFees && <td className={cell}>{exact(row.fees)}</td>}
                  <td className={cell}>{exact(row.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border bg-paper-2 font-medium text-foreground">
              <tr>
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {t(k("schedule.total"))}
                </th>
                <td className={cn(cell, "py-2")}>{exact(sum((row) => row.payment))}</td>
                <td className={cn(cell, "py-2")}>{exact(sum((row) => row.principal))}</td>
                <td className={cn(cell, "py-2")}>{exact(sum((row) => row.interest))}</td>
                {showFees && <td className={cn(cell, "py-2")}>{exact(sum((row) => row.fees))}</td>}
                <td className={cn(cell, "py-2")} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

import { useId, useMemo, useRef, useState } from "react";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorInput from "./CalculatorInput";
import CalculatorResult from "./CalculatorResult";
import {
  INTEREST_PAYOUTS,
  TERM_DEPOSIT_EXAMPLE,
  TERM_DEPOSIT_LIMITS,
  computeTermDeposit,
  type InterestPayout,
  type TermDepositField,
  type TermDepositPayment,
} from "@/lib/calculators/termDeposit";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { cn } from "@/lib/utils";

/** Rows the payment table shows before the visitor asks for the rest. */
const SCHEDULE_PREVIEW_ROWS = 12;

export default function TermDepositCalculator({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <TermDepositCalculatorContent />
    </ReactTranslationsProvider>
  );
}

function TermDepositCalculatorContent() {
  const { t, locale } = useTranslations();
  const k = (key: string) => `tools.termDeposit.${key}`;

  const [amount, setAmount] = useState<number>(TERM_DEPOSIT_EXAMPLE.amount);
  const [annualRate, setAnnualRate] = useState<number>(TERM_DEPOSIT_EXAMPLE.annualRate);
  const [termMonths, setTermMonths] = useState<number>(TERM_DEPOSIT_EXAMPLE.termMonths);
  const [payout, setPayout] = useState<InterestPayout>(TERM_DEPOSIT_EXAMPLE.payout);
  const [reinvest, setReinvest] = useState<boolean>(TERM_DEPOSIT_EXAMPLE.reinvest);
  const [taxRate, setTaxRate] = useState<number>(TERM_DEPOSIT_EXAMPLE.taxRate);

  const calculation = useMemo(
    () => computeTermDeposit({ amount, annualRate, termMonths, payout, reinvest, taxRate }),
    [amount, annualRate, termMonths, payout, reinvest, taxRate],
  );

  // The shared landing tool event: one `tool_used` per page view, on the visitor's first edit,
  // without amounts. pushGtmEvent drops it unless analytics consent was given.
  const usageSent = useRef(false);
  const edit =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      if (!usageSent.current) {
        usageSent.current = true;
        pushGtmEvent({ event: "tool_used", tool: "term_deposit", page_type: getPageType() });
      }
      setter(value);
    };

  const money = (value: number) => formatMoney(locale, value, { decimals: 2 });
  const months = (count: number) =>
    count === 1 ? t(k("monthsOne")) : t(k("monthsMany"), { count: formatNumber(locale, count) });
  const paymentCount = (count: number) =>
    count === 1
      ? t(k("paymentsOne"))
      : t(k("paymentsMany"), { count: formatNumber(locale, count) });

  const limits: Record<TermDepositField, string> = {
    amount: formatMoney(locale, TERM_DEPOSIT_LIMITS.maxAmount),
    annualRate: formatPercent(locale, TERM_DEPOSIT_LIMITS.maxAnnualRate, { decimals: 0 }),
    termMonths: formatNumber(locale, TERM_DEPOSIT_LIMITS.maxTermMonths),
    taxRate: formatPercent(locale, TERM_DEPOSIT_LIMITS.maxTaxRate, { decimals: 0 }),
  };
  const errorFor = (field: TermDepositField): string | undefined => {
    if (calculation.ok) return undefined;
    const error = calculation.errors[field];
    return error ? t(k(`errors.${field}.${error}`), { max: limits[field] }) : undefined;
  };

  const result = calculation.ok ? calculation.result : null;
  const periodic = payout !== "maturity";

  return (
    <>
      <CalculatorLayout>
        {/* Inputs */}
        <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
          <CalculatorInput
            id="termDepositAmount"
            label={t(k("amount"))}
            value={amount}
            onChange={edit(setAmount)}
            min={0}
            max={TERM_DEPOSIT_LIMITS.maxAmount}
            step={500}
            prefix={"€"}
            error={errorFor("amount")}
          />
          <CalculatorInput
            id="termDepositRate"
            label={t(k("annualRate"))}
            value={annualRate}
            onChange={edit(setAnnualRate)}
            min={0}
            max={TERM_DEPOSIT_LIMITS.maxAnnualRate}
            step={0.05}
            suffix="%"
            helpText={t(k("annualRateHelp"))}
            error={errorFor("annualRate")}
          />
          <CalculatorInput
            id="termDepositTerm"
            label={t(k("term"))}
            value={termMonths}
            onChange={edit(setTermMonths)}
            min={TERM_DEPOSIT_LIMITS.minTermMonths}
            max={TERM_DEPOSIT_LIMITS.maxTermMonths}
            step={1}
            suffix={t(k("monthsSuffix"))}
            helpText={t(k("termHelp"), { max: limits.termMonths })}
            error={errorFor("termMonths")}
          />
          <ChoiceGroup
            name="termDepositPayout"
            legend={t(k("payout"))}
            value={payout}
            options={INTEREST_PAYOUTS.map((option) => ({
              value: option,
              label: t(k(`payouts.${option}`)),
            }))}
            onChange={edit(setPayout)}
          />
          {periodic && (
            <ChoiceGroup
              name="termDepositReinvest"
              legend={t(k("reinvest"))}
              value={reinvest ? "reinvest" : "payOut"}
              options={[
                { value: "payOut", label: t(k("reinvestOptions.payOut")) },
                { value: "reinvest", label: t(k("reinvestOptions.reinvest")) },
              ]}
              onChange={edit((value: string) => setReinvest(value === "reinvest"))}
              helpText={t(k("reinvestHelp"))}
            />
          )}
          <CalculatorInput
            id="termDepositTax"
            label={t(k("taxRate"))}
            value={taxRate}
            onChange={edit(setTaxRate)}
            min={0}
            max={TERM_DEPOSIT_LIMITS.maxTaxRate}
            step={1}
            suffix="%"
            helpText={t(k("taxRateHelp"))}
            error={errorFor("taxRate")}
          />
        </div>

        {/* Results */}
        <div className="space-y-6 rounded-card border border-border bg-background p-6 shadow-sm lg:sticky lg:top-24">
          {result ? (
            <>
              <CalculatorResult
                items={[
                  { label: t(k("grossInterest")), value: money(result.grossInterest) },
                  { label: t(k("tax")), value: money(result.tax) },
                  { label: t(k("netInterest")), value: money(result.netInterest) },
                  {
                    label: t(k("netYield")),
                    value: formatPercent(locale, result.effectiveAnnualNetYield, { decimals: 2 }),
                  },
                  {
                    // Paid-out interest is not held in the deposit: the figure is what the saver
                    // receives over the term.
                    label: periodic && !result.reinvested ? t(k("totalReceived")) : t(k("finalBalance")),
                    value: money(result.finalBalance),
                    highlight: true,
                  },
                ]}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                {!periodic
                  ? t(k("resultNote.maturity"), { term: months(result.termMonths) })
                  : result.reinvested
                    ? t(k("resultNote.reinvested"), {
                        term: months(result.termMonths),
                        payments: paymentCount(result.payments.length),
                      })
                    : t(k("resultNote.paidOut"), {
                        term: months(result.termMonths),
                        payments: paymentCount(result.payments.length),
                        principal: money(result.principal),
                      })}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>
          )}
        </div>
      </CalculatorLayout>

      {result && periodic && (
        <PaymentSchedule payments={result.payments} reinvested={result.reinvested} money={money} />
      )}
    </>
  );
}

type Choice<T extends string> = { value: T; label: string };

/** A radio group drawn as a row of segments: one choice, always visible. */
function ChoiceGroup<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
  helpText,
}: {
  name: string;
  legend: string;
  value: T;
  options: ReadonlyArray<Choice<T>>;
  onChange: (value: T) => void;
  helpText?: string;
}) {
  const helpId = useId();

  return (
    <fieldset className="space-y-1.5" aria-describedby={helpText ? helpId : undefined}>
      <legend className="mb-1.5 block text-sm font-medium text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.value} className="relative">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "inline-flex h-9 cursor-pointer items-center rounded-md border px-3 text-sm font-medium transition-colors",
                "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
                value === option.value
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-input bg-background text-foreground hover:bg-accent",
              )}
            >
              {option.label}
            </span>
          </label>
        ))}
      </div>
      {helpText && (
        <p id={helpId} className="text-xs text-muted-foreground">
          {helpText}
        </p>
      )}
    </fieldset>
  );
}

function PaymentSchedule({
  payments,
  reinvested,
  money,
}: {
  payments: TermDepositPayment[];
  reinvested: boolean;
  money: (value: number) => string;
}) {
  const { t, locale } = useTranslations();
  const k = (key: string) => `tools.termDeposit.schedule.${key}`;
  const [showAll, setShowAll] = useState(false);
  const tableId = useId();

  const visible = showAll ? payments : payments.slice(0, SCHEDULE_PREVIEW_ROWS);
  const hidden = payments.length - SCHEDULE_PREVIEW_ROWS;
  const cell = "px-3 py-2 text-right font-mono whitespace-nowrap";

  return (
    <section className="mt-10" aria-labelledby="term-deposit-schedule-title">
      <h2
        id="term-deposit-schedule-title"
        className="text-2xl font-semibold tracking-tight text-foreground"
      >
        {t(k("title"))}
      </h2>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        {reinvested ? t(k("descriptionReinvested")) : t(k("descriptionPaidOut"))}
      </p>

      <div className="mt-6 overflow-x-auto rounded-card border border-border">
        <table id={tableId} className="w-full min-w-[36rem] text-sm">
          <thead className="bg-paper-2 text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                {t(k("payment"))}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t(k("gross"))}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t(k("tax"))}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t(k("net"))}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {reinvested ? t(k("balance")) : t(k("paidOutToDate"))}
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((payment) => (
              <tr key={payment.number} className="border-t border-border">
                <th scope="row" className="px-3 py-2 text-left font-medium text-foreground">
                  {t(k("monthLabel"), { month: formatNumber(locale, payment.month) })}
                </th>
                <td className={cell}>{money(payment.grossInterest)}</td>
                <td className={cell}>{money(payment.tax)}</td>
                <td className={cell}>{money(payment.netInterest)}</td>
                <td className={cell}>
                  {money(reinvested ? payment.balance : payment.paidOutToDate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((current) => !current)}
          aria-expanded={showAll}
          aria-controls={tableId}
          className="mt-3 inline-flex h-9 items-center rounded-md px-2 text-sm font-medium text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {showAll
            ? t(k("showFewer"))
            : t(k("showAll"), { count: formatNumber(locale, payments.length) })}
        </button>
      )}
    </section>
  );
}

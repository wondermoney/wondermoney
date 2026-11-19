import { useEffect, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";
import {
  SAVINGS_CERTIFICATES_EXAMPLE,
  SAVINGS_CERTIFICATES_RULES,
  computeSavingsCertificates,
  type SavingsCertificatesField,
} from "@/lib/calculators/savingsCertificates";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";

const k = (key: string) => `tools.savingsCertificates.${key}`;

export default function SavingsCertificatesCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <SavingsCertificatesCalculator />
    </ReactTranslationsProvider>
  );
}

function SavingsCertificatesCalculator() {
  const { t, locale } = useTranslations();
  const [input, setInput] = useState<{ amount: number; years: number; baseRate: number }>({
    ...SAVINGS_CERTIFICATES_EXAMPLE,
  });
  const used = useRef(false);
  const calculation = computeSavingsCertificates(input);
  const valid = calculation.ok;
  const { minAmount, maxAmount, termYears, maxBaseRate } = SAVINGS_CERTIFICATES_RULES;

  useEffect(() => {
    if (!valid || used.current) return;
    const untouched = input.amount === SAVINGS_CERTIFICATES_EXAMPLE.amount
      && input.years === SAVINGS_CERTIFICATES_EXAMPLE.years
      && input.baseRate === SAVINGS_CERTIFICATES_EXAMPLE.baseRate;
    if (untouched) return;
    used.current = true;
    // Metadata only: the amount, years and rate the visitor typed never leave the page.
    pushGtmEvent({ event: "tool_used", tool: "savings_certificates", page_type: getPageType() });
  }, [input, valid]);

  const money = (value: number) => formatMoney(locale, value, { decimals: 2 });
  const fieldError = (id: SavingsCertificatesField) => {
    const error = calculation.ok ? undefined : calculation.errors[id];
    if (!error) return undefined;
    return t(k(`errors.${error}`), {
      min: formatMoney(locale, minAmount, { decimals: 0 }),
      max: formatMoney(locale, maxAmount, { decimals: 0 }),
      years: formatNumber(locale, termYears),
      rate: formatPercent(locale, maxBaseRate, { decimals: 2 }),
    });
  };
  const set = (id: SavingsCertificatesField) => (value: number) =>
    setInput((current) => ({ ...current, [id]: value }));
  const result = calculation.ok ? calculation.result : null;

  return (
    <CalculatorLayout>
      <div className="space-y-4 rounded-card border border-border bg-background p-6">
        <CalculatorInput
          id="savingsCertificates-amount"
          label={t(k("fields.amount"))}
          value={input.amount}
          onChange={set("amount")}
          min={minAmount}
          max={maxAmount}
          prefix="€"
          error={fieldError("amount")}
        />
        <CalculatorInput
          id="savingsCertificates-years"
          label={t(k("fields.years"))}
          value={input.years}
          onChange={set("years")}
          min={1}
          max={termYears}
          error={fieldError("years")}
        />
        <CalculatorInput
          id="savingsCertificates-baseRate"
          label={t(k("fields.baseRate"))}
          helpText={t(k("fields.baseRateHelp"), {
            rate: formatPercent(locale, maxBaseRate, { decimals: 2 }),
            month: new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" })
              .format(new Date(`${SAVINGS_CERTIFICATES_RULES.referenceBaseRate.month}-01`)),
          })}
          value={input.baseRate}
          onChange={set("baseRate")}
          min={0}
          max={maxBaseRate}
          step={0.01}
          suffix="%"
          error={fieldError("baseRate")}
        />
        <p className="text-sm text-muted-foreground">{t(k("assumption"))}</p>
      </div>
      <div className="space-y-5 rounded-card border border-border bg-background p-6 lg:sticky lg:top-24">
        <div aria-live="polite" aria-atomic="true">
          {result ? (
            <>
              <p className="text-sm text-muted-foreground">{t(k("result.finalValue"))}</p>
              <p id="savingsCertificates-finalValue" className="font-mono text-3xl font-bold text-primary">
                {money(result.finalValue)}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>
          )}
        </div>
        {result && (
          <>
            <CalculatorResult
              items={[
                { label: t(k("result.invested")), value: money(result.invested) },
                { label: t(k("result.grossInterest")), value: money(result.grossInterest) },
                { label: t(k("result.irs")), value: `−${money(result.irs)}` },
                { label: t(k("result.netInterest")), value: money(result.netInterest) },
                { label: t(k("result.premiumInterest")), value: money(result.premiumInterest) },
                { label: t(k("result.netYield")), value: formatPercent(locale, result.netAnnualYield, { decimals: 2 }) },
              ]}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="pb-2 text-left text-sm font-medium text-foreground">
                  {t(k("table.title"))}
                </caption>
                <thead className="text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1 pr-3 font-medium">{t(k("table.year"))}</th>
                    <th scope="col" className="py-1 pr-3 font-medium">{t(k("table.rate"))}</th>
                    <th scope="col" className="py-1 pr-3 text-right font-medium">{t(k("table.gross"))}</th>
                    <th scope="col" className="py-1 pr-3 text-right font-medium">{t(k("table.net"))}</th>
                    <th scope="col" className="py-1 text-right font-medium">{t(k("table.balance"))}</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {result.yearly.map((row) => (
                    <tr key={row.year} className="border-t border-border">
                      <td className="py-1 pr-3">{formatNumber(locale, row.year)}</td>
                      <td className="py-1 pr-3">{formatPercent(locale, row.rate, { decimals: 2 })}</td>
                      <td className="py-1 pr-3 text-right">{money(row.grossInterest)}</td>
                      <td className="py-1 pr-3 text-right">{money(row.grossInterest - row.tax)}</td>
                      <td className="py-1 text-right">{money(row.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </CalculatorLayout>
  );
}

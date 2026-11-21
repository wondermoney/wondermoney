import { useEffect, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";
import {
  computeInflation,
  INFLATION_EXAMPLE,
  INFLATION_MAX_AMOUNT,
  validInflationAmount,
} from "@/lib/calculators/inflation";
import { CPI_YEARS } from "@/lib/calculators/portugalCpi";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatPercent } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";

export default function InflationCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <InflationCalculator />
    </ReactTranslationsProvider>
  );
}

const key = (name: string) => `tools.inflation.${name}`;

function InflationCalculator() {
  const { t, locale } = useTranslations();
  const [input, setInput] = useState(INFLATION_EXAMPLE);
  const [includeBalance, setIncludeBalance] = useState(true);
  const [edited, setEdited] = useState(false);
  const usageSent = useRef(false);

  const finalValue = includeBalance ? input.finalValue : null;
  const result = computeInflation({ ...input, finalValue });
  const hasResult = result !== null;

  useEffect(() => {
    if (!edited || !hasResult || usageSent.current) return;
    usageSent.current = true;
    pushGtmEvent({ event: "tool_used", tool: "inflation", page_type: getPageType() });
  }, [edited, hasResult]);

  const edit = (field: keyof typeof INFLATION_EXAMPLE, value: number) => {
    setEdited(true);
    setInput((current) => ({ ...current, [field]: value }));
  };

  const money = (value: number) => formatMoney(locale, value, { decimals: 2 });
  const moneyChange = (value: number) =>
    formatMoney(locale, value, { decimals: 2, sign: "always" });
  const amountError = (value: number) =>
    validInflationAmount(value)
      ? undefined
      : t(key("amountError"), { max: formatMoney(locale, INFLATION_MAX_AMOUNT) });

  const year = (field: "from" | "to") => (
    <div className="space-y-1.5">
      <label htmlFor={`inflation-${field}`} className="block text-sm font-medium">
        {t(key(field))}
      </label>
      <select
        id={`inflation-${field}`}
        value={input[field]}
        onChange={(event) => edit(field, Number(event.currentTarget.value))}
        className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {CPI_YEARS.map((year) => <option key={year} value={year}>{year}</option>)}
      </select>
    </div>
  );

  return (
    <CalculatorLayout>
      <div className="space-y-5 rounded-card border border-border bg-background p-6">
        <div className="grid grid-cols-2 gap-4">{year("from")}{year("to")}</div>
        <CalculatorInput
          id="inflation-amount"
          label={t(key("amount"), { year: input.from })}
          value={input.amount}
          onChange={(value) => edit("amount", value)}
          min={0}
          max={INFLATION_MAX_AMOUNT}
          prefix="€"
          helpText={t(key("amountHelp"))}
          error={amountError(input.amount)}
        />
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={includeBalance}
            onChange={(event) => {
              setEdited(true);
              setIncludeBalance(event.currentTarget.checked);
            }}
            className="size-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {t(key("includeBalance"))}
        </label>
        {includeBalance && (
          <CalculatorInput
            id="inflation-final-value"
            label={t(key("finalValue"), { year: input.to })}
            value={input.finalValue}
            onChange={(value) => edit("finalValue", value)}
            min={0}
            max={INFLATION_MAX_AMOUNT}
            prefix="€"
            helpText={t(key("finalValueHelp"))}
            error={amountError(input.finalValue)}
          />
        )}
      </div>

      <div
        className="min-w-0 space-y-5 rounded-card border border-border bg-background p-6 [overflow-wrap:anywhere]"
        aria-live="polite"
      >
        {result ? (
          <CalculatorResult items={[
              { label: t(key("equivalent"), { year: input.to }), value: money(result.equivalent), highlight: true },
              { label: t(key("priceChange")), value: formatPercent(locale, result.priceChange, { decimals: 2, sign: "always" }) },
              { label: t(key("budgetChange")), value: moneyChange(result.budgetChange) },
              ...(result.realValue !== null && result.realChange !== null ? [
                { label: t(key("realValue"), { year: input.from }), value: money(result.realValue) },
                { label: t(key("realChange")), value: moneyChange(result.realChange) },
              ] : []),
            ]} />
        ) : <p className="text-sm text-muted-foreground">{t(key("invalid"))}</p>}
      </div>
    </CalculatorLayout>
  );
}

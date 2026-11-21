import { useEffect, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";
import {
  computePropertyTax,
  PROPERTY_TAX_EXAMPLE,
  PROPERTY_TAX_LIMITS,
  URBAN_RATE_MAX,
  URBAN_RATE_MIN,
  type PropertyKind,
} from "@/lib/calculators/propertyTax";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatPercent } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";

const k = (key: string) => `tools.propertyTax.${key}`;
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function PropertyTaxCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <PropertyTaxCalculator />
    </ReactTranslationsProvider>
  );
}

function PropertyTaxCalculator() {
  const { t, locale } = useTranslations();
  const [input, setInput] = useState(PROPERTY_TAX_EXAMPLE);
  const used = useRef(false);
  const calculation = computePropertyTax(input);
  const valid = calculation.ok;
  const urban = input.kind === "urban";
  const errors = calculation.ok ? {} : calculation.errors;

  useEffect(() => {
    if (input === PROPERTY_TAX_EXAMPLE || !valid || used.current) return;
    used.current = true;
    // Metadata only: never the property value, rate or result.
    pushGtmEvent({ event: "tool_used", tool: "property_tax", page_type: getPageType() });
  }, [input, valid]);

  const money = (value: number) => formatMoney(locale, value, { decimals: 2 });
  const result = calculation.ok ? calculation.result : null;

  return (
    <CalculatorLayout>
      <div className="space-y-5 rounded-card border border-border bg-background p-6">
        <div className="space-y-1.5">
          <label htmlFor="propertyTax-kind" className="block text-sm font-medium text-foreground">
            {t(k("fields.kind"))}
          </label>
          <select
            id="propertyTax-kind"
            value={input.kind}
            onChange={(event) => {
              const kind = event.currentTarget.value as PropertyKind;
              setInput((current) => ({ ...current, kind }));
            }}
            className={selectClass}
          >
            <option value="urban">{t(k("kinds.urban"))}</option>
            <option value="rustic">{t(k("kinds.rustic"))}</option>
          </select>
        </div>
        <CalculatorInput
          id="propertyTax-vpt"
          label={t(k("fields.vpt"))}
          value={input.vpt}
          onChange={(value) => setInput((current) => ({ ...current, vpt: value }))}
          min={0}
          max={PROPERTY_TAX_LIMITS.vpt}
          prefix="€"
          helpText={t(k("vptHelp"))}
          error={errors.vpt ? t(k(`errors.${errors.vpt}`), { max: formatMoney(locale, PROPERTY_TAX_LIMITS.vpt, { decimals: 0 }) }) : undefined}
        />
        {urban ? (
          <>
            <CalculatorInput
              id="propertyTax-rate"
              label={t(k("fields.rate"))}
              value={input.rate}
              onChange={(value) => setInput((current) => ({ ...current, rate: value }))}
              min={URBAN_RATE_MIN}
              max={URBAN_RATE_MAX}
              step={0.005}
              suffix="%"
              helpText={t(k("rateHelp"), {
                min: formatPercent(locale, URBAN_RATE_MIN, { decimals: 2 }),
                max: formatPercent(locale, URBAN_RATE_MAX, { decimals: 2 }),
              })}
              error={errors.rate ? t(k(`errors.${errors.rate}`), {
                min: formatPercent(locale, URBAN_RATE_MIN, { decimals: 2 }),
                max: formatPercent(locale, URBAN_RATE_MAX, { decimals: 2 }),
              }) : undefined}
            />
            <div className="space-y-1.5">
              <label htmlFor="propertyTax-dependants" className="block text-sm font-medium text-foreground">
                {t(k("fields.dependants"))}
              </label>
              <select
                id="propertyTax-dependants"
                value={input.dependants}
                onChange={(event) => {
                  const dependants = Number(event.currentTarget.value);
                  setInput((current) => ({ ...current, dependants }));
                }}
                className={selectClass}
                aria-describedby="propertyTax-dependants-help"
              >
                {[0, 1, 2, 3].map((value) => (
                  <option key={value} value={value}>{t(k(`dependantsOptions.${value}`))}</option>
                ))}
              </select>
              <p id="propertyTax-dependants-help" className="text-sm text-muted-foreground">
                {t(k("dependantsHelp"))}
              </p>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t(k("rusticNote"), { rate: formatPercent(locale, 0.8, { decimals: 1 }) })}
          </p>
        )}
      </div>
      <div className="space-y-5 rounded-card border border-border bg-background p-6 lg:sticky lg:top-24">
        {!result && <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>}
        {result && (
          <>
            <CalculatorResult
              items={[
                {
                  label: t(k("result.annualTax")),
                  value: money(result.annualTax),
                  highlight: true,
                  id: "propertyTax-annualTax",
                },
                ...(result.deduction > 0 ? [
                  { label: t(k("result.grossTax")), value: money(result.grossTax) },
                  { label: t(k("result.deduction")), value: `−${money(result.deduction)}` },
                ] : []),
                { label: t(k("result.monthlyProvision")), value: money(result.monthlyProvision) },
              ]}
            />
            <div>
              <p className="text-sm font-medium text-foreground">{t(k("result.scheduleTitle"))}</p>
              {result.schedule.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">{t(k(result.belowMinimum ? "result.belowMinimum" : "result.nothingDue"))}</p>
              ) : (
                <ul className="mt-2 divide-y divide-border text-sm">
                  {result.schedule.map((row) => (
                    <li key={row.month} className="flex justify-between py-2">
                      <span className="text-muted-foreground">{t(k(`months.${row.month}`))}</span>
                      <span className="font-mono font-semibold">{money(row.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {result ? `${t(k("result.annualTax"))}: ${money(result.annualTax)}` : ""}
        </p>
      </div>
    </CalculatorLayout>
  );
}

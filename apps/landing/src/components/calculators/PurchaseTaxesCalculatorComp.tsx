import { useEffect, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";
import {
  PURCHASE_TAXES_EXAMPLE,
  PURCHASE_TAXES_LIMITS,
  PURCHASE_TAXES_TABLE,
  REGIONS,
  USES,
  YOUNG_LIMITS,
  computePurchaseTaxes,
  type PurchaseTaxesNumberField,
} from "@/lib/calculators/purchaseTaxes";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatPercent } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { cn } from "@/lib/utils";

const k = (key: string) => `tools.purchaseTaxes.${key}`;

export default function PurchaseTaxesCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <PurchaseTaxesCalculator />
    </ReactTranslationsProvider>
  );
}

function PurchaseTaxesCalculator() {
  const { t, locale } = useTranslations();
  const [input, setInput] = useState(PURCHASE_TAXES_EXAMPLE);
  const used = useRef(false);
  const calculation = computePurchaseTaxes(input);
  const valid = calculation.ok;
  const money = (value: number) => formatMoney(locale, value, { decimals: 2 });

  useEffect(() => {
    if (input === PURCHASE_TAXES_EXAMPLE || !valid || used.current) return;
    used.current = true;
    pushGtmEvent({ event: "tool_used", tool: "purchase_taxes", page_type: getPageType() });
  }, [input, valid]);

  const field = (id: PurchaseTaxesNumberField) => {
    const error = calculation.ok ? undefined : calculation.errors[id];
    return (
      <CalculatorInput
        key={id}
        id={`purchaseTaxes-${id}`}
        label={t(k(`fields.${id}`))}
        helpText={t(k(`help.${id}`))}
        value={input[id]}
        onChange={(value) => setInput((current) => ({ ...current, [id]: value }))}
        min={0}
        max={PURCHASE_TAXES_LIMITS[id]}
        step={1}
        prefix="€"
        error={error
          ? t(k(`errors.${error}`), { max: formatMoney(locale, PURCHASE_TAXES_LIMITS[id], { decimals: 0 }) })
          : undefined}
      />
    );
  };

  const result = calculation.ok ? calculation.result : null;
  const own = input.use === "ownPermanent";
  const limits = YOUNG_LIMITS(input.region);
  const youngValues = {
    full: formatMoney(locale, limits.full, { decimals: 0 }),
    partial: formatMoney(locale, limits.partial, { decimals: 0 }),
  };

  return (
    <CalculatorLayout>
      <div className="space-y-6 rounded-card border border-border bg-background p-6">
        <fieldset className="space-y-4">
          <legend className="mb-3 text-lg font-semibold">{t(k("propertyTitle"))}</legend>
          {field("price")}
          {field("taxValue")}
          <ChoiceGroup
            name="purchaseTaxes-region"
            legend={t(k("fields.region"))}
            value={input.region}
            options={REGIONS.map((value) => ({ value, label: t(k(`regions.${value}`)) }))}
            onChange={(region) => setInput((current) => ({ ...current, region }))}
          />
          <ChoiceGroup
            name="purchaseTaxes-use"
            legend={t(k("fields.use"))}
            value={input.use}
            options={USES.map((value) => ({ value, label: t(k(`uses.${value}`)) }))}
            onChange={(use) => setInput((current) => ({ ...current, use }))}
          />
        </fieldset>
        <div className="border-t border-border pt-5">
          <fieldset className="space-y-4">
            <legend className="mb-3 text-lg font-semibold">{t(k("financingTitle"))}</legend>
            {field("loan")}
          </fieldset>
        </div>
        <div className="border-t border-border pt-5">
          <fieldset className="space-y-3">
            <legend className="mb-3 text-lg font-semibold">{t(k("youngTitle"))}</legend>
            {own ? (
              <>
                <label className="flex items-start gap-3 text-sm font-medium text-foreground">
                  <input
                    type="checkbox"
                    id="purchaseTaxes-young"
                    checked={input.young}
                    onChange={(event) => setInput((current) => ({ ...current, young: event.target.checked }))}
                    className="mt-1 h-4 w-4"
                  />
                  <span>{t(k("fields.young"))}</span>
                </label>
                <p className="text-xs text-muted-foreground">{t(k("youngNote"), youngValues)}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t(k("youngUnavailable"))}</p>
            )}
          </fieldset>
        </div>
      </div>
      <div className="space-y-5 rounded-card border border-border bg-background p-6 lg:sticky lg:top-24">
        {!result && <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>}
        {result && (
          <>
            <div>
              <CalculatorResult
                items={[
                  { label: t(k("result.total")), value: money(result.total), highlight: true, id: "purchaseTaxes-total" },
                  { label: t(k("result.reference")), value: money(result.reference) },
                  { label: t(k("result.imt")), value: money(result.imt) },
                  { label: t(k("result.stampPurchase")), value: money(result.stampPurchase) },
                  ...(input.loan > 0
                    ? [{ label: t(k("result.stampLoan")), value: money(result.stampLoan) }]
                    : []),
                ]}
              />
              <p className="mt-2 text-sm text-muted-foreground">
                {t(k("result.effectiveRate"), { rate: formatPercent(locale, result.effectiveRate, { decimals: 2 }) })}
              </p>
            </div>
            {result.exemption !== "none" && (
              <p className="rounded-md bg-paper-2 p-3 text-sm text-foreground">
                {t(k(result.exemption === "full" ? "result.exemptFull" : "result.exemptPartial"), {
                  saving: money(result.youngSaving),
                })}
              </p>
            )}
            {input.young && own && result.exemption === "none" && (
              <p className="text-sm text-muted-foreground">{t(k("result.exemptNone"), youngValues)}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {t(k("result.tableNote"), {
                year: String(PURCHASE_TAXES_TABLE.year),
                date: PURCHASE_TAXES_TABLE.reviewedOn,
              })}
            </p>
          </>
        )}
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {result ? `${t(k("result.total"))}: ${money(result.total)}` : ""}
        </p>
      </div>
    </CalculatorLayout>
  );
}

function ChoiceGroup<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
}: {
  name: string;
  legend: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="space-y-1.5">
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
                "inline-flex min-h-9 cursor-pointer items-center rounded-md border px-3 py-1 text-sm font-medium transition-colors",
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
    </fieldset>
  );
}

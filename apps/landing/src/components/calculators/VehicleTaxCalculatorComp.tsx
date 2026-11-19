import { useEffect, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";
import {
  computeVehicleTax,
  VEHICLE_TAX_EXAMPLE,
  VEHICLE_TAX_LIMITS,
  type Co2Standard,
  type VehicleFuel,
} from "@/lib/calculators/vehicleTax";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";

const k = (key: string) => `tools.vehicleTax.${key}`;
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export default function VehicleTaxCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <VehicleTaxCalculator />
    </ReactTranslationsProvider>
  );
}

function VehicleTaxCalculator() {
  const { t, locale } = useTranslations();
  const [input, setInput] = useState(VEHICLE_TAX_EXAMPLE);
  const used = useRef(false);
  const calculation = computeVehicleTax(input);
  const valid = calculation.ok;
  const errors = calculation.ok ? {} : calculation.errors;
  const electric = input.fuel === "electric";
  const beforeCategoryB =
    input.year < 2007 || (input.year === 2007 && input.month < 7);

  useEffect(() => {
    if (input === VEHICLE_TAX_EXAMPLE || !valid || used.current) return;
    used.current = true;
    // Metadata only: never the engine size, emissions, registration date or result.
    pushGtmEvent({ event: "tool_used", tool: "vehicle_tax", page_type: getPageType() });
  }, [input, valid]);

  const money = (value: number) => formatMoney(locale, value, { decimals: 2 });
  const result = calculation.ok ? calculation.result : null;
  const monthName = (month: number) =>
    new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, month - 1, 1)));
  const err = (key: string | undefined, values?: Record<string, string>) =>
    key ? t(k(`errors.${key}`), values) : undefined;

  return (
    <CalculatorLayout>
      <div className="space-y-5 rounded-card border border-border bg-background p-6">
        <div className="space-y-1.5">
          <label htmlFor="vehicleTax-fuel" className="block text-sm font-medium text-foreground">
            {t(k("fields.fuel"))}
          </label>
          <select
            id="vehicleTax-fuel"
            value={input.fuel}
            onChange={(event) => {
              const fuel = event.currentTarget.value as VehicleFuel;
              setInput((current) => ({ ...current, fuel }));
            }}
            className={selectClass}
            aria-invalid={errors.fuel ? true : undefined}
          >
            {(["petrol", "diesel", "electric"] as const).map((fuel) => (
              <option key={fuel} value={fuel}>{t(k(`fuels.${fuel}`))}</option>
            ))}
          </select>
          {errors.fuel && <p role="alert" className="text-sm text-destructive">{err(errors.fuel)}</p>}
        </div>
        {electric ? (
          <p className="text-sm text-muted-foreground">{t(k("electricNote"))}</p>
        ) : (
          <CalculatorInput
            id="vehicleTax-cc"
            label={t(k("fields.cc"))}
            value={input.cc}
            onChange={(value) => setInput((current) => ({ ...current, cc: value }))}
            min={1}
            max={VEHICLE_TAX_LIMITS.cc}
            suffix="cm³"
            helpText={t(k("ccHelp"))}
            error={err(errors.cc, { max: String(VEHICLE_TAX_LIMITS.cc) })}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <CalculatorInput
            id="vehicleTax-year"
            label={t(k("fields.year"))}
            value={input.year}
            onChange={(value) => setInput((current) => ({ ...current, year: value }))}
            min={VEHICLE_TAX_LIMITS.firstYear}
            max={VEHICLE_TAX_LIMITS.lastYear}
            error={err(errors.year, { min: String(VEHICLE_TAX_LIMITS.firstYear), max: String(VEHICLE_TAX_LIMITS.lastYear) })}
          />
          <div className="space-y-1.5">
            <label htmlFor="vehicleTax-month" className="block text-sm font-medium text-foreground">
              {t(k("fields.month"))}
            </label>
            <select
              id="vehicleTax-month"
              value={input.month}
              onChange={(event) => {
                const month = Number(event.currentTarget.value);
                setInput((current) => ({ ...current, month }));
              }}
              className={selectClass}
            >
              {MONTHS.map((month) => (
                <option key={month} value={month}>{monthName(month)}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{t(k("registrationHelp"))}</p>
        {!electric && !beforeCategoryB && (
          <>
            <CalculatorInput
              id="vehicleTax-co2"
              label={t(k("fields.co2"))}
              value={input.co2}
              onChange={(value) => setInput((current) => ({ ...current, co2: value }))}
              min={1}
              max={VEHICLE_TAX_LIMITS.co2}
              suffix="g/km"
              helpText={t(k("co2Help"))}
              error={err(errors.co2, { max: String(VEHICLE_TAX_LIMITS.co2) })}
            />
            <div className="space-y-1.5">
              <label htmlFor="vehicleTax-standard" className="block text-sm font-medium text-foreground">
                {t(k("fields.standard"))}
              </label>
              <select
                id="vehicleTax-standard"
                value={input.standard}
                onChange={(event) => {
                  const standard = event.currentTarget.value as Co2Standard;
                  setInput((current) => ({ ...current, standard }));
                }}
                className={selectClass}
              >
                <option value="wltp">{t(k("standards.wltp"))}</option>
                <option value="nedc">{t(k("standards.nedc"))}</option>
              </select>
            </div>
          </>
        )}
      </div>
      <div className="space-y-5 rounded-card border border-border bg-background p-6 lg:sticky lg:top-24">
        <div aria-live="polite" aria-atomic="true">
          {result ? (
            <>
              <p className="text-sm text-muted-foreground">{t(k("result.annualTax"))}</p>
              <p id="vehicleTax-annualTax" className="font-mono text-3xl font-bold text-primary">
                {money(result.annualTax)}
              </p>
              {result.exempt && <p className="mt-2 text-sm text-muted-foreground">{t(k("result.exempt"))}</p>}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>
          )}
        </div>
        {result && (
          <>
            <CalculatorResult
              items={[
                { label: t(k("result.monthlyProvision")), value: money(result.monthlyProvision), highlight: true },
                { label: t(k("result.category")), value: result.category },
                ...(!result.exempt && result.category === "B"
                  ? [
                      { label: t(k("result.baseTax")), value: money(result.baseTax) },
                      ...(result.additionalTax > 0
                        ? [{ label: t(k("result.additionalTax")), value: money(result.additionalTax) }]
                        : []),
                      { label: t(k("result.coefficient")), value: `×${result.coefficient.toFixed(2)}` },
                    ]
                  : []),
                ...(result.dieselSurcharge > 0
                  ? [{ label: t(k("result.dieselSurcharge")), value: money(result.dieselSurcharge) }]
                  : []),
              ]}
            />
            {!result.exempt && (
              <div className="space-y-3 text-sm">
                <p>
                  <span className="font-medium text-foreground">{t(k("result.dueMonth"))}</span>{" "}
                  <span className="text-muted-foreground">
                    {t(k("result.dueMonthValue"), { month: monthName(result.dueMonth) })}
                  </span>
                </p>
                {([["scheduleTitle", result.schedule2027], ["scheduleTitle2028", result.schedule2028]] as const).map(
                  ([title, rows]) => (
                    <div key={title}>
                      <p className="font-medium text-foreground">{t(k(`result.${title}`))}</p>
                      <ul className="mt-2 divide-y divide-border">
                        {rows.map((row) => (
                          <li key={row.month} className="flex justify-between py-2">
                            <span className="text-muted-foreground">{monthName(row.month)}</span>
                            <span className="font-mono font-semibold">{money(row.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ),
                )}
              </div>
            )}
          </>
        )}
      </div>
    </CalculatorLayout>
  );
}

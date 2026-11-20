import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";
import {
  computeVehicleTaxes,
  MAX_VEHICLES,
  VEHICLE_DETAILS_EXAMPLE,
  VEHICLE_TAX_EXAMPLE,
  VEHICLE_TAX_LIMITS,
  type Co2Standard,
  type PaymentMonth,
  type VehicleDetails,
  type VehicleFuel,
  type VehicleTaxCalculation,
} from "@/lib/calculators/vehicleTax";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";

const k = (key: string) => `tools.vehicleTax.${key}`;
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const textInputClass =
  "w-full rounded-lg border border-input px-3 py-2.5 text-sm transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring";
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const NAME_MAX_LENGTH = 30;

/** `number` is the default label's number ("Car 2"); it stays with the vehicle when others are removed. */
interface VehicleEntry {
  number: number;
  name: string;
  details: VehicleDetails;
}

const INITIAL_VEHICLES: VehicleEntry[] = [{ number: 1, name: "", details: VEHICLE_DETAILS_EXAMPLE }];

/** The smallest number no vehicle uses, so a removed "Car 2" frees its label without renaming the others. */
function nextNumber(vehicles: readonly VehicleEntry[]) {
  let number = 1;
  while (vehicles.some((vehicle) => vehicle.number === number)) number += 1;
  return number;
}

export default function VehicleTaxCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <VehicleTaxCalculator />
    </ReactTranslationsProvider>
  );
}

function VehicleTaxCalculator() {
  const { t, locale } = useTranslations();
  const [vehicles, setVehicles] = useState(INITIAL_VEHICLES);
  const [otherIucEuros, setOtherIucEuros] = useState(VEHICLE_TAX_EXAMPLE.otherIucEuros);
  const [announcement, setAnnouncement] = useState("");
  const [pendingFocus, setPendingFocus] = useState<number | "add" | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const used = useRef(false);
  const calculation = computeVehicleTaxes(vehicles.map((vehicle) => vehicle.details), otherIucEuros);
  const { summary } = calculation;
  const multiple = vehicles.length > 1;
  const untouched = vehicles === INITIAL_VEHICLES && otherIucEuros === VEHICLE_TAX_EXAMPLE.otherIucEuros;

  useEffect(() => {
    if (untouched || !summary || used.current) return;
    used.current = true;
    // Metadata only: never the engine size, emissions, registration date, names, count or result.
    pushGtmEvent({ event: "tool_used", tool: "vehicle_tax", page_type: getPageType() });
  }, [untouched, summary]);

  useEffect(() => {
    if (pendingFocus === null) return;
    if (pendingFocus === "add") addButton.current?.focus();
    else document.getElementById(`vehicleTax-v${pendingFocus}-name`)?.focus();
    setPendingFocus(null);
  }, [pendingFocus]);

  const labelOf = (vehicle: VehicleEntry) =>
    vehicle.name.trim() || t(k("vehicles.label"), { n: String(vehicle.number) });
  const money = (value: number) => formatMoney(locale, value, { decimals: 2 });
  const monthName = (month: number) =>
    new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, month - 1, 1)));
  const err = (key: string | undefined, values?: Record<string, string>) =>
    key ? t(k(`errors.${key}`), values) : undefined;

  const updateVehicle = (number: number, patch: Partial<VehicleEntry>) =>
    setVehicles((current) => current.map((vehicle) => (vehicle.number === number ? { ...vehicle, ...patch } : vehicle)));
  const updateDetails = (number: number, patch: Partial<VehicleDetails>) =>
    setVehicles((current) =>
      current.map((vehicle) => (vehicle.number === number ? { ...vehicle, details: { ...vehicle.details, ...patch } } : vehicle)),
    );
  const addVehicle = () => {
    if (vehicles.length >= MAX_VEHICLES) return;
    const number = nextNumber(vehicles);
    setVehicles([...vehicles, { number, name: "", details: VEHICLE_DETAILS_EXAMPLE }]);
    setAnnouncement("");
    setPendingFocus(number);
  };
  const removeVehicle = (vehicle: VehicleEntry) => {
    setVehicles(vehicles.filter((entry) => entry.number !== vehicle.number));
    setAnnouncement(t(k("vehicles.removed"), { name: labelOf(vehicle) }));
    setPendingFocus("add");
  };

  const otherError = calculation.otherIucError;
  const single = !multiple && calculation.vehicles[0]?.ok ? calculation.vehicles[0].result : null;

  return (
    <CalculatorLayout>
      <div className="space-y-5 rounded-card border border-border bg-background p-6">
        <div className="divide-y divide-border">
          {vehicles.map((vehicle, index) => (
            <VehicleFieldset
              key={vehicle.number}
              vehicle={vehicle}
              label={labelOf(vehicle)}
              multiple={multiple}
              calculation={calculation.vehicles[index]}
              onName={(name) => updateVehicle(vehicle.number, { name })}
              onChange={(patch) => updateDetails(vehicle.number, patch)}
              onRemove={() => removeVehicle(vehicle)}
              money={money}
              monthName={monthName}
              err={err}
            />
          ))}
        </div>
        {vehicles.length < MAX_VEHICLES ? (
          <button
            ref={addButton}
            type="button"
            onClick={addVehicle}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-input bg-secondary px-4 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] motion-reduce:active:scale-100"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t(k("vehicles.add"))}
          </button>
        ) : (
          <p className="text-sm text-muted-foreground">{t(k("vehicles.max"), { max: String(MAX_VEHICLES) })}</p>
        )}
        <p role="status" className="sr-only">{announcement}</p>
        <div className="border-t border-border pt-5">
          <CalculatorInput
            id="vehicleTax-other"
            label={t(k("fields.otherIuc"))}
            value={otherIucEuros}
            onChange={setOtherIucEuros}
            min={0}
            max={VEHICLE_TAX_LIMITS.otherIuc}
            prefix="€"
            helpText={t(k("otherIucHelp"))}
            error={err(otherError, { max: formatMoney(locale, VEHICLE_TAX_LIMITS.otherIuc, { decimals: 0 }) })}
          />
        </div>
      </div>
      <div className="space-y-5 rounded-card border border-border bg-background p-6 lg:sticky lg:top-24">
        <div aria-live="polite" aria-atomic="true">
          {summary ? (
            <>
              <p className="text-sm text-muted-foreground">
                {t(k(multiple ? "result.annualTaxAll" : "result.annualTax"))}
              </p>
              <p id="vehicleTax-annualTax" className="font-mono text-3xl font-bold text-primary">
                {money(summary.annualTax)}
              </p>
              {single?.exempt && <p className="mt-2 text-sm text-muted-foreground">{t(k("result.exempt"))}</p>}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>
          )}
        </div>
        {summary && single && (
          <>
            <CalculatorResult
              items={[
                { label: t(k("result.monthlyProvision")), value: money(single.monthlyProvision), highlight: true },
                { label: t(k("result.category")), value: single.category },
                ...(!single.exempt && single.category === "B"
                  ? [
                      { label: t(k("result.baseTax")), value: money(single.baseTax) },
                      ...(single.additionalTax > 0
                        ? [{ label: t(k("result.additionalTax")), value: money(single.additionalTax) }]
                        : []),
                      { label: t(k("result.coefficient")), value: `×${single.coefficient.toFixed(2)}` },
                    ]
                  : []),
                ...(single.dieselSurcharge > 0
                  ? [{ label: t(k("result.dieselSurcharge")), value: money(single.dieselSurcharge) }]
                  : []),
                ...(otherIucEuros > 0
                  ? [{ label: t(k("result.totalAnnualTax")), value: money(single.totalAnnualTax) }]
                  : []),
              ]}
            />
            {!single.exempt && (
              <div className="space-y-3 text-sm">
                <p>
                  <span className="font-medium text-foreground">{t(k("result.dueMonth"))}</span>{" "}
                  <span className="text-muted-foreground">
                    {t(k("result.dueMonthValue"), { month: monthName(single.dueMonth) })}
                  </span>
                </p>
                {otherIucEuros > 0 && (
                  <p className="text-muted-foreground">
                    {t(k("result.scheduleShareNote"), { total: money(single.totalAnnualTax) })}
                  </p>
                )}
                <Schedules
                  schedules={[["scheduleTitle", summary.schedule2027], ["scheduleTitle2028", summary.schedule2028]]}
                  money={money}
                  monthName={monthName}
                />
              </div>
            )}
          </>
        )}
        {summary && multiple && (
          <>
            <CalculatorResult
              items={[
                { label: t(k("result.monthlyProvision")), value: money(summary.monthlyProvision), highlight: true },
                ...(otherIucEuros > 0
                  ? [{ label: t(k("result.totalAnnualTax")), value: money(summary.totalAnnualTax) }]
                  : []),
              ]}
            />
            <div className="text-sm">
              <p className="font-medium text-foreground">{t(k("result.perVehicleTitle"))}</p>
              <ul className="mt-2 divide-y divide-border">
                {vehicles.map((vehicle, index) => {
                  const entry = calculation.vehicles[index];
                  if (!entry.ok) return null;
                  return (
                    <li key={vehicle.number} className="flex justify-between gap-4 py-2">
                      <span className="min-w-0 break-words text-muted-foreground">
                        {t(k(entry.result.exempt ? "result.vehicleRowExempt" : "result.vehicleRow"), {
                          name: labelOf(vehicle),
                          category: entry.result.category,
                        })}
                      </span>
                      <span className="font-mono font-semibold">{money(entry.result.annualTax)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            {summary.due2026.length > 0 && (
              <div className="space-y-3 text-sm">
                <Schedules
                  schedules={[["scheduleTitle2026", summary.due2026]]}
                  money={money}
                  monthName={monthName}
                  names={(indexes) =>
                    new Intl.ListFormat(locale, { type: "conjunction" }).format(
                      indexes.map((index) => labelOf(vehicles[index])),
                    )
                  }
                />
                <p className="text-muted-foreground">
                  {otherIucEuros > 0
                    ? t(k("result.scheduleTotalOtherNote"), { total: money(summary.totalAnnualTax) })
                    : t(k("result.scheduleTotalNote"), { total: money(summary.totalAnnualTax) })}
                </p>
                <Schedules
                  schedules={[["scheduleTitle", summary.schedule2027], ["scheduleTitle2028", summary.schedule2028]]}
                  money={money}
                  monthName={monthName}
                />
              </div>
            )}
          </>
        )}
      </div>
    </CalculatorLayout>
  );
}

function Schedules({
  schedules,
  money,
  monthName,
  names,
}: {
  schedules: [string, PaymentMonth[]][];
  money: (value: number) => string;
  monthName: (month: number) => string;
  /** Lists the vehicles under each month when given. */
  names?: (indexes: number[]) => string;
}) {
  const { t } = useTranslations();
  return schedules.map(([title, rows]) => (
    <div key={title}>
      <p className="font-medium text-foreground">{t(k(`result.${title}`))}</p>
      <ul className="mt-2 divide-y divide-border">
        {rows.map((row) => (
          <li key={row.month} className="flex justify-between gap-4 py-2">
            <span className="min-w-0 text-muted-foreground">
              {monthName(row.month)}
              {names && <span className="block break-words text-xs">{names(row.vehicles)}</span>}
            </span>
            <span className="font-mono font-semibold">{money(row.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  ));
}

function VehicleFieldset({
  vehicle,
  label,
  multiple,
  calculation,
  onName,
  onChange,
  onRemove,
  money,
  monthName,
  err,
}: {
  vehicle: VehicleEntry;
  label: string;
  multiple: boolean;
  calculation: VehicleTaxCalculation;
  onName: (name: string) => void;
  onChange: (patch: Partial<VehicleDetails>) => void;
  onRemove: () => void;
  money: (value: number) => string;
  monthName: (month: number) => string;
  err: (key: string | undefined, values?: Record<string, string>) => string | undefined;
}) {
  const { t } = useTranslations();
  const input = vehicle.details;
  const id = (field: string) => `vehicleTax-v${vehicle.number}-${field}`;
  const errors = calculation.ok ? {} : calculation.errors;
  const electric = input.fuel === "electric";
  const beforeCategoryB = input.year < 2007 || (input.year === 2007 && input.month < 7);

  return (
    // The padding sits on a wrapper: a fieldset's own padding falls between its legend and its fields.
    <div className="py-6 first:pt-0 last:pb-0">
      <fieldset className="space-y-5">
        <legend className={multiple ? "text-base font-semibold text-foreground" : "sr-only"}>{label}</legend>
        {multiple && (
          <div className="space-y-1.5">
            <label htmlFor={id("name")} className="block text-sm font-medium text-foreground">
              {t(k("vehicles.name"))}
            </label>
            <input
              id={id("name")}
              type="text"
              value={vehicle.name}
              maxLength={NAME_MAX_LENGTH}
              placeholder={t(k("vehicles.label"), { n: String(vehicle.number) })}
              autoComplete="off"
              onChange={(event) => onName(event.currentTarget.value)}
              className={textInputClass}
            />
          </div>
        )}
        <div className="space-y-1.5">
          <label htmlFor={id("fuel")} className="block text-sm font-medium text-foreground">
            {t(k("fields.fuel"))}
          </label>
          <select
            id={id("fuel")}
            value={input.fuel}
            onChange={(event) => onChange({ fuel: event.currentTarget.value as VehicleFuel })}
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
            id={id("cc")}
            label={t(k("fields.cc"))}
            value={input.cc}
            onChange={(value) => onChange({ cc: value })}
            min={1}
            max={VEHICLE_TAX_LIMITS.cc}
            suffix="cm³"
            helpText={t(k("ccHelp"))}
            error={err(errors.cc, { max: String(VEHICLE_TAX_LIMITS.cc) })}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <CalculatorInput
            id={id("year")}
            label={t(k("fields.year"))}
            value={input.year}
            onChange={(value) => onChange({ year: value })}
            min={VEHICLE_TAX_LIMITS.firstYear}
            max={VEHICLE_TAX_LIMITS.lastYear}
            error={err(errors.year, { min: String(VEHICLE_TAX_LIMITS.firstYear), max: String(VEHICLE_TAX_LIMITS.lastYear) })}
          />
          <div className="space-y-1.5">
            <label htmlFor={id("month")} className="block text-sm font-medium text-foreground">
              {t(k("fields.month"))}
            </label>
            <select
              id={id("month")}
              value={input.month}
              onChange={(event) => onChange({ month: Number(event.currentTarget.value) })}
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
              id={id("co2")}
              label={t(k("fields.co2"))}
              value={input.co2}
              onChange={(value) => onChange({ co2: value })}
              min={1}
              max={VEHICLE_TAX_LIMITS.co2}
              suffix="g/km"
              helpText={t(k("co2Help"))}
              error={err(errors.co2, { max: String(VEHICLE_TAX_LIMITS.co2) })}
            />
            <div className="space-y-1.5">
              <label htmlFor={id("standard")} className="block text-sm font-medium text-foreground">
                {t(k("fields.standard"))}
              </label>
              <select
                id={id("standard")}
                value={input.standard}
                onChange={(event) => onChange({ standard: event.currentTarget.value as Co2Standard })}
                className={selectClass}
              >
                <option value="wltp">{t(k("standards.wltp"))}</option>
                <option value="nedc">{t(k("standards.nedc"))}</option>
              </select>
            </div>
          </>
        )}
        {multiple && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted px-4 py-3">
            {calculation.ok ? (
              <p className="text-sm">
                <span className="text-muted-foreground">{t(k("result.annualTax"))}</span>{" "}
                <span className="font-mono font-semibold text-foreground">{money(calculation.result.annualTax)}</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>
            )}
            <button
              type="button"
              onClick={onRemove}
              aria-label={t(k("vehicles.remove"), { name: label })}
              className="inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              {t(k("vehicles.removeShort"))}
            </button>
          </div>
        )}
      </fieldset>
    </div>
  );
}

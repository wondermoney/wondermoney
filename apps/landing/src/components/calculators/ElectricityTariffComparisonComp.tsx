// The electricity tariff comparator island. It renders the form on the server and loads ERSE's
// offers (data/electricityOffers.ts, about 60 kB gzipped) with a dynamic import once it runs in
// the browser, so the offers never reach another page's bundle. The page logic is in
// lib/calculators/electricityTariffComparator.ts; this file holds the form state. Asked to price
// indexed offers from OMIE's prices, it loads the monthly market data and the suppliers' formulas
// (data/indexedMarket.ts) the same way, and with a load diagram the quarter-hour prices
// (public/data/omie-pt-quarter-hours.json) with a fetch.
import { Check, ChevronDown, CreditCard, Leaf, Link2, Lock, Unlock, UserCheck, Wrench, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import ElectricityInvoiceUpload from "./ElectricityInvoiceUpload";
import ElectricityTariffResults, { k, monthRange, PERIOD_KEYS } from "./ElectricityTariffResults";
import {
  ElectricitySolarPanel,
  ElectricitySolarSummary,
  INITIAL_SOLAR,
  useSolar,
  type SolarLoader,
  type SolarProductionLoader,
  type SolarSettings,
} from "./ElectricitySolarPanel";
import type { ContractedPowerKva, ElectricityOffer } from "@/lib/calculators/electricityOfferTypes";
import {
  CONTRACTED_POWER_OPTIONS_KVA,
  TARIFF_COMPARISON_LIMITS,
  type ComparisonSort,
  type TariffOption,
} from "@/lib/calculators/electricityTariffComparison";
import {
  ERedesExportError,
  parseERedesExport,
  summarizeLoadDiagram,
  type HourlyCycle,
  type LoadDiagramSummary,
  type LoadReading,
  type PeriodKwh,
} from "@/lib/calculators/electricityPeriods";
import {
  diagramBasis,
  profileBasis,
  type IndexedFormula,
  type IndexedPricing,
  type MarketBasis,
  type OmieMonth,
  type OmieQuarterHours,
} from "@/lib/calculators/indexedPricing";
import {
  COMPARATOR_LIMITS,
  DEFAULT_OFFER_FILTERS,
  MONTH_DAYS,
  OPTION_PERIODS,
  monthlyKwhFromBill,
  myTariffErrors,
  periodsFromEntry,
  runComparator,
  splitTotal,
  supplierChoices,
  type ComparatorRequest,
  type MyTariffPrices,
  type OfferFilters,
} from "@/lib/calculators/electricityTariffComparator";
import { solarBillSaving } from "@/lib/calculators/electricitySolar";
import { applyInvoiceReading } from "@/lib/calculators/electricityInvoice";
import { readShareFragment, shareFragment } from "@/lib/calculators/electricityComparatorShare";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { Select } from "@/components/ui/select";
import { FieldMessage } from "@/components/ui/fieldMessage";

/** What the page shows of ELECTRICITY_OFFERS_SOURCE. */
export interface OffersSource {
  url: string;
  exportedOn: string;
  offerCount: number;
  supplierCount: number;
}

/** Loads ERSE's offers. A prop so tests can pass fixtures; the page uses the dynamic import. */
export type OffersLoader = () => Promise<{
  ELECTRICITY_OFFERS: readonly ElectricityOffer[];
  ELECTRICITY_OFFERS_SOURCE: OffersSource;
}>;

const loadErseOffers: OffersLoader = () => import("@/lib/calculators/data/electricityOffers");

/** What the page shows of OMIE_PRICES_SOURCE. */
export interface MarketSource {
  url: string;
  profilesUrl: string;
  quarterHoursPath: string;
}

/** Loads the monthly OMIE data and the suppliers' formulas (data/indexedMarket.ts). */
export type MarketLoader = () => Promise<{
  OMIE_MONTHS: readonly OmieMonth[];
  OMIE_PRICES_SOURCE: MarketSource;
  INDEXED_FORMULAS: readonly IndexedFormula[];
}>;

/** Loads the quarter-hour prices for the diagram mode. */
export type QuarterHoursLoader = (path: string) => Promise<OmieQuarterHours>;

const loadIndexedMarket: MarketLoader = () => import("@/lib/calculators/data/indexedMarket");
const fetchQuarterHours: QuarterHoursLoader = async (path) => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as OmieQuarterHours;
};

export default function ElectricityTariffComparisonComp({
  locale,
  loadOffers,
  loadSolar,
  loadSolarProduction,
  loadMarket,
  loadQuarterHours,
}: {
  locale: Lang;
  loadOffers?: OffersLoader;
  loadSolar?: SolarLoader;
  loadSolarProduction?: SolarProductionLoader;
  loadMarket?: MarketLoader;
  loadQuarterHours?: QuarterHoursLoader;
}) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <ElectricityTariffComparison
        loadOffers={loadOffers ?? loadErseOffers}
        loadSolar={loadSolar}
        loadSolarProduction={loadSolarProduction}
        loadMarket={loadMarket ?? loadIndexedMarket}
        loadQuarterHours={loadQuarterHours ?? fetchQuarterHours}
      />
    </ReactTranslationsProvider>
  );
}

type Mode = "quick" | "full";
type QuickUnit = "bill" | "kwh";
type Source = "periods" | "total" | "diagram";
type PeriodChoice = "month" | "year" | "days";
/** How indexed offers are priced: ERSE's estimate, or OMIE's real prices with each formula. */
type IndexedChoice = "erse" | "market";

interface FormState {
  mode: Mode;
  contractedPower: ContractedPowerKva;
  option: TariffOption;
  cycle: HourlyCycle;
  quickUnit: QuickUnit;
  bill: number;
  monthlyKwh: number;
  source: Source;
  period: PeriodChoice;
  days: number;
  total: number;
  periods: number[];
  socialTariff: boolean;
  largeFamily: boolean;
  newClient: boolean;
  includeConditioned: boolean;
  includeRefunds: boolean;
  includeDual: boolean;
  cheapestPerSupplier: boolean;
  sortBy: ComparisonSort;
  filters: OfferFilters;
  myTariffOn: boolean;
  myPower: number;
  myEnergy: number[];
  indexed: IndexedChoice;
}

const INITIAL: FormState = {
  mode: "quick",
  contractedPower: 3.45,
  option: "simple",
  cycle: "daily",
  quickUnit: "bill",
  bill: 50,
  monthlyKwh: 200,
  source: "periods",
  period: "month",
  days: 30,
  total: 200,
  periods: [200, 130, 70],
  socialTariff: false,
  largeFamily: false,
  newClient: false,
  includeConditioned: true,
  includeRefunds: true,
  includeDual: false,
  cheapestPerSupplier: true,
  sortBy: "firstYear",
  filters: DEFAULT_OFFER_FILTERS,
  myTariffOn: false,
  myPower: Number.NaN,
  myEnergy: [Number.NaN, Number.NaN, Number.NaN],
  indexed: "erse",
};

type Load =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; offers: readonly ElectricityOffer[]; source: OffersSource };

type Diagram =
  | { state: "none" }
  | { state: "reading"; name: string }
  | { state: "error"; message: string }
  | { state: "ready"; name: string; summary: LoadDiagramSummary; readings: readonly LoadReading[] };

type Async<T> = { state: "idle" } | { state: "loading" } | { state: "error" } | { state: "ready"; value: T };

/** A diagram's dates must cover this many of the 12 months to price indexed offers on them. */
export const MIN_DIAGRAM_MONTHS = 6;

/** The market basis the page priced on, for the results' notes. */
export interface MarketView {
  basis: MarketBasis;
  source: MarketSource;
  /**
   * Why a diagram's dates were not used, and the last 12 months were instead: none of its days
   * has prices ("outOfRange"), or they cover fewer than MIN_DIAGRAM_MONTHS months ("short").
   */
  diagramFallback: "outOfRange" | "short" | null;
  /** With "short": the months the diagram covers. */
  diagramMonths?: number;
}

/** One tap for a common bill or consumption; the field still takes any value. */
const BILL_PRESETS = [30, 50, 75, 100, 150] as const;
const KWH_PRESETS = [100, 200, 300, 400, 600] as const;

const summaryClass =
  "flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden";
const chevronClass = "size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none";


function ElectricityTariffComparison({
  loadOffers,
  loadSolar,
  loadSolarProduction,
  loadMarket,
  loadQuarterHours,
}: {
  loadOffers: OffersLoader;
  loadSolar?: SolarLoader;
  loadSolarProduction?: SolarProductionLoader;
  loadMarket: MarketLoader;
  loadQuarterHours: QuarterHoursLoader;
}) {
  const { t, locale } = useTranslations();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [diagram, setDiagram] = useState<Diagram>({ state: "none" });
  const [market, setMarket] = useState<Async<Awaited<ReturnType<MarketLoader>>>>({ state: "idle" });
  const [quarterHours, setQuarterHours] = useState<Async<OmieQuarterHours>>({ state: "idle" });
  const [edited, setEdited] = useState(false);
  const [solarSettings, setSolarSettings] = useState<SolarSettings>(INITIAL_SOLAR);
  const [shared, setShared] = useState<"idle" | "copied" | "failed">("idle");
  const usageSent = useRef(false);

  // A share link's settings, read once; the fragment then leaves the address bar so the bill and
  // the consumption are not kept in the history or copied on with the page's address.
  useEffect(() => {
    const read = readShareFragment(window.location.hash);
    if (!read) return;
    const { filters, ...rest } = read;
    setForm((current) => ({ ...current, ...rest, filters: { ...current.filters, ...filters } }));
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#calculator`);
    document.getElementById("calculator")?.scrollIntoView();
  }, []);
  useEffect(() => {
    if (shared === "idle") return;
    const timer = window.setTimeout(() => setShared("idle"), 4000);
    return () => window.clearTimeout(timer);
  }, [shared]);

  useEffect(() => {
    let cancelled = false;
    loadOffers()
      .then((module) => {
        if (!cancelled) setLoad({ state: "ready", offers: module.ELECTRICITY_OFFERS, source: module.ELECTRICITY_OFFERS_SOURCE });
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [loadOffers]);

  const wantsMarket = form.indexed === "market";
  const usesDiagram = form.mode === "full" && form.source === "diagram" && diagram.state === "ready";
  useEffect(() => {
    if (!wantsMarket || market.state !== "idle") return;
    setMarket({ state: "loading" });
    loadMarket()
      .then((value) => setMarket({ state: "ready", value }))
      .catch(() => setMarket({ state: "error" }));
  }, [wantsMarket, market.state, loadMarket]);
  useEffect(() => {
    if (!wantsMarket || !usesDiagram || market.state !== "ready" || quarterHours.state !== "idle") return;
    setQuarterHours({ state: "loading" });
    loadQuarterHours(market.value.OMIE_PRICES_SOURCE.quarterHoursPath)
      .then((value) => setQuarterHours({ state: "ready", value }))
      .catch(() => setQuarterHours({ state: "error" }));
  }, [wantsMarket, usesDiagram, market, quarterHours.state, loadQuarterHours]);

  useEffect(() => {
    if (!edited || usageSent.current) return;
    usageSent.current = true;
    // Metadata only: never the bill, the consumption, the prices, the file or the results.
    pushGtmEvent({ event: "tool_used", tool: "electricity_tariff_comparison", page_type: getPageType() });
  }, [edited]);

  const update = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setEdited(true);
    setForm((current) => ({ ...current, [field]: value }));
  };
  const updateFilter = <K extends keyof OfferFilters>(field: K, value: OfferFilters[K]) => {
    setEdited(true);
    setForm((current) => ({ ...current, filters: { ...current.filters, [field]: value } }));
  };
  const setListValue = (field: "periods" | "myEnergy", index: number, value: number) => {
    setEdited(true);
    setForm((current) => {
      const list = [...current[field]];
      list[index] = value;
      return { ...current, [field]: list };
    });
  };

  const offers = load.state === "ready" ? load.offers : null;
  const regulated = useMemo(() => offers?.find((offer) => offer.regulated) ?? null, [offers]);
  const kwhText = (value: number) => `${formatNumber(locale, value, 0)} kWh`;
  const euro = (value: number) => formatMoney(locale, value, { decimals: 2 });

  // The consumption, or the message of the field that stops it.
  const consumption = useMemo((): { kwh: PeriodKwh; fromBill?: number } | { error: string; field: string } | null => {
    const { contractedPower, option, cycle } = form;
    const number = (value: number, max: number, field: string) =>
      !Number.isFinite(value)
        ? { error: t(k("errors.required")), field }
        : value < 0
          ? { error: t(k("errors.negative")), field }
          : value > max
            ? { error: t(k("errors.tooLarge"), { max: formatNumber(locale, max, 0) }), field }
            : null;
    if (form.mode === "quick") {
      if (form.quickUnit === "kwh") {
        const invalid = number(form.monthlyKwh, COMPARATOR_LIMITS.maxMonthlyKwh, "monthlyKwh");
        return invalid ?? { kwh: splitTotal(form.monthlyKwh, MONTH_DAYS, contractedPower) };
      }
      const invalid = number(form.bill, COMPARATOR_LIMITS.maxMonthlyBill, "bill");
      if (invalid) return invalid;
      if (!regulated) return null;
      const solved = monthlyKwhFromBill(regulated, {
        bill: form.bill,
        contractedPower,
        option,
        cycle,
        socialTariff: form.socialTariff,
        largeFamily: form.largeFamily,
      });
      if (!solved.ok) {
        const values =
          solved.error === "belowFixed" ? { minimum: euro(solved.minimum) } : solved.error === "tooLarge" ? { maximum: euro(solved.maximum) } : {};
        const key = solved.error === "tooLarge" ? "billTooLarge" : solved.error;
        return { error: t(k(`errors.${key}`), values), field: "bill" };
      }
      return { kwh: splitTotal(solved.monthlyKwh, MONTH_DAYS, contractedPower), fromBill: solved.monthlyKwh };
    }
    if (form.source === "diagram") {
      if (diagram.state !== "ready") return { error: t(k("errors.noDiagram")), field: "diagram" };
      return { kwh: diagram.summary };
    }
    const days = form.period === "month" ? MONTH_DAYS : form.period === "year" ? 365 : form.days;
    if (form.period === "days" && (!Number.isInteger(days) || days < 1 || days > TARIFF_COMPARISON_LIMITS.maxDays)) {
      return { error: t(k("errors.days"), { max: String(TARIFF_COMPARISON_LIMITS.maxDays) }), field: "days" };
    }
    const max = (COMPARATOR_LIMITS.maxMonthlyKwh * days) / MONTH_DAYS;
    if (form.source === "total") {
      const invalid = number(form.total, max, "total");
      return invalid ?? { kwh: splitTotal(form.total, days, contractedPower) };
    }
    const values = form.periods.slice(0, OPTION_PERIODS[option]);
    for (let i = 0; i < values.length; i++) {
      const invalid = number(values[i], max, `period${i}`);
      if (invalid) return invalid;
    }
    return { kwh: periodsFromEntry(option, values, days, contractedPower, cycle) };
  }, [form, regulated, diagram, t, locale]);

  const myTariff: MyTariffPrices | null = form.myTariffOn
    ? { powerPerDay: form.myPower, energy: form.myEnergy.slice(0, OPTION_PERIODS[form.option]) }
    : null;
  const myErrors = myTariff ? myTariffErrors(form.option, myTariff) : {};

  const grossKwh = consumption && "kwh" in consumption ? consumption.kwh : null;
  const solar = useSolar(
    solarSettings,
    {
      consumption: grossKwh,
      readings: form.mode === "full" && form.source === "diagram" && diagram.state === "ready" ? diagram.readings : null,
      contractedPower: form.contractedPower,
      cycle: form.cycle,
    },
    loadSolar,
    loadSolarProduction,
  );

  // The market basis: the diagram's own dates when they cover at least half of the 12 months,
  // else the last 12 months. With solar, the readings netted against the production: what the
  // household draws from the grid.
  const marketView = useMemo((): MarketView | null => {
    if (!wantsMarket || market.state !== "ready") return null;
    const { OMIE_MONTHS, OMIE_PRICES_SOURCE } = market.value;
    const lastYear = profileBasis(OMIE_MONTHS);
    if (usesDiagram && diagram.state === "ready") {
      if (quarterHours.state === "loading" || quarterHours.state === "idle") return null;
      const readings = solar.result?.readings ?? diagram.readings;
      const basis = quarterHours.state === "ready" ? diagramBasis(readings, quarterHours.value) : null;
      if (basis && basis.months.length >= MIN_DIAGRAM_MONTHS) return { basis, source: OMIE_PRICES_SOURCE, diagramFallback: null };
      const fallback = quarterHours.state === "error" ? null : basis ? "short" : "outOfRange";
      return { basis: lastYear, source: OMIE_PRICES_SOURCE, diagramFallback: fallback, diagramMonths: basis?.months.length ?? 0 };
    }
    return { basis: lastYear, source: OMIE_PRICES_SOURCE, diagramFallback: null };
  }, [wantsMarket, market, usesDiagram, diagram, quarterHours, solar.result]);
  const indexedPricing: IndexedPricing | undefined =
    marketView && market.state === "ready" ? { basis: marketView.basis, formulas: market.value.INDEXED_FORMULAS } : undefined;

  // Ranked on the grid consumption when solar is on; the saving prices the best offer without it.
  const comparison = useMemo(() => {
    if (!offers || !grossKwh) return null;
    const request: ComparatorRequest = {
      offers,
      consumption: solar.result?.kwh ?? grossKwh,
      contractedPower: form.contractedPower,
      cycle: form.cycle,
      option: form.option,
      socialTariff: form.socialTariff,
      largeFamily: form.largeFamily,
      newClient: form.newClient,
      includeRefunds: form.includeRefunds,
      includeConditioned: form.includeConditioned,
      includeDual: form.includeDual,
      cheapestPerSupplier: form.cheapestPerSupplier,
      sortBy: form.sortBy,
      filters: form.filters,
      myTariff,
      indexedPricing,
    };
    const outcome = runComparator(request);
    const solarSaving = solar.result && outcome.ok ? solarBillSaving(request, outcome.view, grossKwh) : null;
    return { outcome, solarSaving };
    // myTariff and indexedPricing are rebuilt on every render; form and marketView cover them.
  }, [offers, grossKwh, solar.result, form, marketView]);
  const outcome = comparison?.outcome ?? null;

  const suppliers = useMemo(() => (offers ? supplierChoices(offers, t(k("regulatedSupplier"))) : []), [offers, t]);
  const errorOf = (field: string) => (consumption && "error" in consumption && consumption.field === field ? consumption.error : undefined);
  const engineError =
    outcome && !outcome.ok ? t(k(`errors.${Object.values(outcome.errors)[0] ?? "required"}`), { max: String(TARIFF_COMPARISON_LIMITS.maxDays) }) : undefined;

  const readDiagram = async (file: File | undefined) => {
    if (!file) return;
    setEdited(true);
    setDiagram({ state: "reading", name: file.name });
    try {
      const readings = await parseERedesExport(new Uint8Array(await file.arrayBuffer()));
      setDiagram({ state: "ready", name: file.name, summary: summarizeLoadDiagram(readings), readings });
    } catch (error) {
      const code = error instanceof ERedesExportError ? error.code : "unreadable";
      const row = error instanceof ERedesExportError && error.row !== undefined ? String(error.row) : "";
      setDiagram({ state: "error", message: t(k(`diagram.errors.${code}`), { row }) });
    }
  };

  const optionLabel = (option: TariffOption) => t(k(`options.${option}`));
  const checkbox = (id: string, label: string, checked: boolean, onChange: (value: boolean) => void, help?: string) => (
    <div className="space-y-1">
      <label htmlFor={id} className="flex items-start gap-2 text-sm text-foreground">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
          aria-describedby={help ? `${id}-help` : undefined}
          className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span>{label}</span>
      </label>
      {help && (
        <span id={`${id}-help`} className="sr-only">
          {help}
        </span>
      )}
    </div>
  );
  const select = <V extends string>(
    id: string,
    label: string,
    value: V,
    choices: readonly { value: V; label: string }[],
    onChange: (value: V) => void,
    help?: string,
    hideLabel = false,
  ) => (
    <div className="space-y-1.5">
      <label htmlFor={id} className={hideLabel ? "sr-only" : "block text-sm font-medium text-foreground"}>
        {label}
      </label>
      <Select
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value as V)}
        aria-describedby={help ? `${id}-help` : undefined}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </Select>
      {help && (
        <FieldMessage id={`${id}-help`}>
          {help}
        </FieldMessage>
      )}
    </div>
  );
  const segmented = <V extends string>(
    name: string,
    legend: string,
    value: V,
    choices: readonly { value: V; label: string }[],
    onChange: (value: V) => void,
    hideLegend = false,
  ) => (
    <fieldset>
      <legend className={hideLegend ? "sr-only" : "mb-2 text-sm font-medium text-foreground"}>{legend}</legend>
      <div className="grid gap-1 rounded-md bg-paper-2 p-1" style={{ gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))` }}>
        {choices.map((choice) => (
          <label
            key={choice.value}
            className={`flex min-h-9 cursor-pointer items-center justify-center rounded-[4px] px-2 py-1.5 text-center text-sm font-medium leading-tight has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
              value === choice.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <input type="radio" name={name} value={choice.value} checked={value === choice.value} onChange={() => onChange(choice.value)} className="sr-only" />
            {choice.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
  const chip = (id: string, label: string, checked: boolean, onChange: (value: boolean) => void, Icon: LucideIcon) => (
    <label
      htmlFor={id}
      className={`inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 ${
        checked ? "border-primary bg-primary/10 font-medium text-primary" : "border-input bg-background text-foreground hover:bg-paper-2"
      }`}
    >
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} className="sr-only" />
      {checked ? <Check aria-hidden="true" className="size-3.5" /> : <Icon aria-hidden="true" className="size-3.5 text-muted-foreground" />}
      {label}
    </label>
  );
  const presets = (values: readonly number[], current: number, onPick: (value: number) => void, format: (value: number) => string, label: string) => (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={current === value}
          onClick={() => onPick(value)}
          className={`h-8 rounded-md border px-2.5 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
            current === value ? "border-primary bg-primary/10 text-primary" : "border-input bg-background text-foreground hover:bg-paper-2"
          }`}
        >
          {format(value)}
        </button>
      ))}
    </div>
  );
  const periodLabel = (option: TariffOption, index: number) => t(k(`periods.${PERIOD_KEYS[option][index]}`));
  const fromBill = consumption && "fromBill" in consumption ? consumption.fromBill : undefined;
  const kva = (power: number) => formatNumber(locale, power, 2);

  // The inputs in one line, for the bar over the list on a phone, where the form is far above.
  const summary = [
    `${kva(form.contractedPower)} kVA`,
    optionLabel(form.option),
    form.mode === "quick"
      ? form.quickUnit === "bill"
        ? t(k("summary.bill"), { amount: euro(form.bill) })
        : t(k("summary.kwh"), { kwh: kwhText(form.monthlyKwh) })
      : form.source === "diagram"
        ? t(k("summary.diagram"))
        : t(k("summary.full")),
  ].join(" · ");

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}${shareFragment(form)}`;
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ url, title: document.title });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared("copied");
    } catch {
      setShared("failed");
    }
  };

  const toolbar = (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {select(
          "tariff-view",
          t(k("filters.view")),
          form.cheapestPerSupplier ? "best" : "all",
          [
            { value: "best", label: t(k("filters.viewChoices.best")) },
            { value: "all", label: t(k("filters.viewChoices.all")) },
          ],
          (value) => update("cheapestPerSupplier", value === "best"),
          undefined,
          true,
        )}
        {select(
          "tariff-supplier",
          t(k("filters.supplier")),
          form.filters.supplier ?? "",
          [{ value: "", label: t(k("filters.supplierAll")) }, ...suppliers.map((supplier) => ({ value: supplier.code, label: supplier.name }))],
          (value) => updateFilter("supplier", value === "" ? null : value),
          undefined,
          true,
        )}
      </div>
      <fieldset>
        <legend className="sr-only">{t(k("filters.quick"))}</legend>
        <div className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
          {chip("tariff-fixed", t(k("filters.chips.fixed")), form.filters.pricing === "fixed", (value) => updateFilter("pricing", value ? "fixed" : "all"), Lock)}
          {chip("tariff-loyalty", t(k("filters.chips.noLoyalty")), form.filters.noLoyalty, (value) => updateFilter("noLoyalty", value), Unlock)}
          {chip("tariff-conditioned", t(k("filters.chips.noConditioned")), !form.includeConditioned, (value) => update("includeConditioned", !value), UserCheck)}
          {chip("tariff-directdebit", t(k("filters.chips.noDirectDebit")), !form.filters.allowDirectDebit, (value) => updateFilter("allowDirectDebit", !value), CreditCard)}
          {chip("tariff-services", t(k("filters.chips.noServices")), !form.filters.allowMandatoryServices, (value) => updateFilter("allowMandatoryServices", !value), Wrench)}
          {chip("tariff-renewable", t(k("filters.chips.renewable")), form.filters.renewableOnly, (value) => updateFilter("renewableOnly", value), Leaf)}
        </div>
      </fieldset>
    </div>
  );

  const shareButton = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={share}
        className="inline-flex h-10 items-center gap-1.5 rounded-md border border-input bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-paper-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98] motion-reduce:active:scale-100"
      >
        <Link2 aria-hidden="true" className="size-4" />
        {t(k("share.button"))}
      </button>
      <span role="status" className="text-xs text-muted-foreground">
        {shared === "copied" ? t(k("share.copied")) : shared === "failed" ? t(k("share.failed")) : ""}
      </span>
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <form
        id="tariff-form"
        className="tariff-form min-w-0 scroll-mt-20 space-y-6 lg:sticky lg:top-20 lg:-m-1 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:overscroll-contain lg:p-1 lg:pb-4"
        onSubmit={(event) => event.preventDefault()}
        aria-label={t(k("formLabel"))}
      >
        <ElectricityInvoiceUpload
          onApply={(reading) => {
            setEdited(true);
            setForm((current) => applyInvoiceReading(current, reading));
          }}
        />
        <div className="space-y-5 rounded-card border border-border bg-background p-5">
          {segmented(
            "tariff-mode",
            t(k("mode.legend")),
            form.mode,
            (["quick", "full"] as const).map((mode) => ({ value: mode, label: t(k(`mode.${mode}`)) })),
            (value) => update("mode", value),
            true,
          )}

          {select(
            "tariff-power",
            t(k("fields.powerKva")),
            String(form.contractedPower),
            CONTRACTED_POWER_OPTIONS_KVA.map((power) => ({ value: String(power), label: kva(power) })),
            (value) => update("contractedPower", Number(value) as ContractedPowerKva),
          )}

          {segmented(
            "tariff-option",
            t(k("fields.option")),
            form.option,
            (["simple", "biHourly", "triHourly"] as const).map((option) => ({ value: option, label: optionLabel(option) })),
            (value) => update("option", value),
          )}
          {form.option !== "simple" &&
            select(
              "tariff-cycle",
              t(k("fields.cycle")),
              form.cycle,
              (["daily", "weekly"] as const).map((cycle) => ({ value: cycle, label: t(k(`cycles.${cycle}`)) })),
              (value) => update("cycle", value),
            )}

          {form.mode === "quick" ? (
            <>
              {segmented(
                "tariff-unit",
                t(k("fields.quickUnit")),
                form.quickUnit,
                [
                  { value: "bill", label: t(k("fields.unitBill")) },
                  { value: "kwh", label: t(k("fields.unitKwh")) },
                ],
                (value) => update("quickUnit", value),
                true,
              )}
              {form.quickUnit === "bill" ? (
                <div className="space-y-2">
                  <CalculatorInput
                    id="tariff-bill"
                    label={t(k("fields.bill"))}
                    value={form.bill}
                    onChange={(value) => update("bill", value)}
                    min={0}
                    max={COMPARATOR_LIMITS.maxMonthlyBill}
                    step={5}
                    prefix="€"
                    helpText={fromBill !== undefined ? t(k("help.billKwh"), { kwh: kwhText(fromBill) }) : undefined}
                    error={errorOf("bill")}
                  />
                  {presets(BILL_PRESETS, form.bill, (value) => update("bill", value), (value) => euro(value).replace(/[.,]00(?=\D*$)/, ""), t(k("presets.bill")))}
                </div>
              ) : (
                <div className="space-y-2">
                  <CalculatorInput
                    id="tariff-kwh"
                    label={t(k("fields.monthlyKwh"))}
                    value={form.monthlyKwh}
                    onChange={(value) => update("monthlyKwh", value)}
                    min={0}
                    max={COMPARATOR_LIMITS.maxMonthlyKwh}
                    step={10}
                    suffix="kWh"
                    error={errorOf("monthlyKwh")}
                  />
                  {presets(KWH_PRESETS, form.monthlyKwh, (value) => update("monthlyKwh", value), kwhText, t(k("presets.kwh")))}
                </div>
              )}
            </>
          ) : (
            <>
              {select(
                "tariff-source",
                t(k("fields.source")),
                form.source,
                (["periods", "total", "diagram"] as const).map((source) => ({ value: source, label: t(k(`sources.${source}`)) })),
                (value) => update("source", value),
              )}
              {form.source !== "diagram" && (
                <>
                  {select(
                    "tariff-period",
                    t(k("fields.period")),
                    form.period,
                    (["month", "year", "days"] as const).map((period) => ({ value: period, label: t(k(`periodChoices.${period}`)) })),
                    (value) => update("period", value),
                  )}
                  {form.period === "days" && (
                    <CalculatorInput
                      id="tariff-days"
                      label={t(k("fields.days"))}
                      value={form.days}
                      onChange={(value) => update("days", value)}
                      min={1}
                      max={TARIFF_COMPARISON_LIMITS.maxDays}
                      step={1}
                      helpText={t(k("help.days"))}
                      error={errorOf("days")}
                    />
                  )}
                </>
              )}
              {form.source === "total" && (
                <CalculatorInput
                  id="tariff-total"
                  label={t(k("fields.total"))}
                  value={form.total}
                  onChange={(value) => update("total", value)}
                  min={0}
                  step={10}
                  suffix="kWh"
                  helpText={t(k("help.total"))}
                  error={errorOf("total")}
                />
              )}
              {form.source === "periods" && (
                <fieldset className="space-y-4">
                  <legend className="text-sm font-medium text-foreground">{t(k("fields.periodsLegend"))}</legend>
                  {PERIOD_KEYS[form.option].map((_, index) => (
                    <CalculatorInput
                      key={`${form.option}-${index}`}
                      id={`tariff-period-${index}`}
                      label={periodLabel(form.option, index)}
                      value={form.periods[index]}
                      onChange={(value) => setListValue("periods", index, value)}
                      min={0}
                      step={10}
                      suffix="kWh"
                      error={errorOf(`period${index}`)}
                    />
                  ))}
                  <p className="text-xs text-muted-foreground">{t(k("help.periods"))}</p>
                </fieldset>
              )}
              {form.source === "diagram" && <DiagramUpload diagram={diagram} onFile={readDiagram} onClear={() => setDiagram({ state: "none" })} />}
            </>
          )}

          <fieldset className="space-y-3 border-t border-border pt-5">
            <legend className="sr-only">{t(k("household.legend"))}</legend>
            <p aria-hidden="true" className="text-sm font-medium text-foreground">
              {t(k("household.legend"))}
            </p>
            {checkbox("tariff-social", t(k("household.socialTariff")), form.socialTariff, (value) => update("socialTariff", value), t(k("household.socialTariffHelp")))}
            {checkbox("tariff-family", t(k("household.largeFamily")), form.largeFamily, (value) => update("largeFamily", value), t(k("household.largeFamilyHelp")))}
            {checkbox("tariff-newclient", t(k("household.newClient")), form.newClient, (value) => update("newClient", value), t(k("household.newClientHelp")))}
          </fieldset>

        </div>

        <ElectricitySolarPanel
          settings={solarSettings}
          onChange={(settings) => {
            setEdited(true);
            setSolarSettings(settings);
          }}
          production={solar.production}
          onRetry={solar.retry}
        />


        <details className="group rounded-card border border-border bg-background" open={form.myTariffOn || undefined}>
          <summary className={summaryClass}>
            <span>{t(k("myTariff.title"))}</span>
            <ChevronDown aria-hidden="true" className={chevronClass} />
          </summary>
          <div className="space-y-4 border-t border-border px-6 py-5">
            <p className="text-sm text-ink-2">{t(k("myTariff.intro"))}</p>
            {checkbox("tariff-mine", t(k("myTariff.toggle")), form.myTariffOn, (value) => update("myTariffOn", value))}
            {form.myTariffOn && (
              <fieldset className="space-y-4">
                <legend className="sr-only">{t(k("myTariff.legend"), { option: optionLabel(form.option) })}</legend>
                <CalculatorInput
                  id="tariff-mine-power"
                  label={t(k("myTariff.power"))}
                  value={form.myPower}
                  onChange={(value) => update("myPower", value)}
                  min={0}
                  max={5}
                  step={0.0001}
                  suffix={t(k("myTariff.powerUnit"))}
                  error={myErrors.powerPerDay === "outOfRange" ? t(k("myTariff.errors.outOfRange")) : undefined}
                />
                {PERIOD_KEYS[form.option].map((_, index) => (
                  <CalculatorInput
                    key={`${form.option}-${index}`}
                    id={`tariff-mine-energy-${index}`}
                    label={form.option === "simple" ? t(k("myTariff.energySimple")) : t(k("myTariff.energy"), { period: periodLabel(form.option, index) })}
                    value={form.myEnergy[index]}
                    onChange={(value) => setListValue("myEnergy", index, value)}
                    min={0}
                    max={5}
                    step={0.0001}
                    suffix="€/kWh"
                    error={myErrors[`energy${index}`] === "outOfRange" ? t(k("myTariff.errors.outOfRange")) : undefined}
                  />
                ))}
                <p className="text-xs text-muted-foreground">{t(k("myTariff.help"), { option: optionLabel(form.option) })}</p>
              </fieldset>
            )}
          </div>
        </details>

        <details className="group rounded-card border border-border bg-background">
          <summary className={summaryClass}>
            <span>
              {t(k("filters.title"))}
              <span className="sr-only"> {t(k("filters.summary"))}</span>
            </span>
            <ChevronDown aria-hidden="true" className={chevronClass} />
          </summary>
          <div className="space-y-5 border-t border-border px-6 py-5">
            {select(
              "tariff-sort",
              t(k("filters.sortBy")),
              form.sortBy,
              (["firstYear", "laterYears"] as const).map((sort) => ({ value: sort, label: t(k(`filters.sortChoices.${sort}`)) })),
              (value) => update("sortBy", value),
            )}
          <IndexedChoiceField
              value={form.indexed}
              onChange={(value) => update("indexed", value)}
              diagram={usesDiagram}
              market={market.state}
              quarterHours={quarterHours.state}
              view={marketView}
            />
            {checkbox("tariff-refunds", t(k("filters.includeRefunds")), form.includeRefunds, (value) => update("includeRefunds", value), t(k("filters.includeRefundsHelp")))}
            {checkbox("tariff-einvoice", t(k("filters.eInvoice")), form.filters.allowEInvoice, (value) => updateFilter("allowEInvoice", value))}
            {checkbox("tariff-dual", t(k("filters.includeDual")), form.includeDual, (value) => update("includeDual", value), t(k("filters.includeDualHelp")))}
          </div>
        </details>
      </form>

      <div className="min-w-0">
        <div className={`sticky top-[3.625rem] z-10 -mx-6 mb-6 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-6 py-2.5 backdrop-blur-md lg:hidden`}>
          <p className="min-w-0 truncate text-sm text-foreground">
            <span className="sr-only">{t(k("summary.label"))}: </span>
            {summary}
          </p>
          <a href="#tariff-form" className="shrink-0 text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4">
            {t(k("summary.change"))}
          </a>
        </div>
        {load.state === "loading" && (
          <p role="status" className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">
            {t(k("loading"))}
          </p>
        )}
        {load.state === "error" && (
          <p role="alert" className="rounded-lg border border-destructive-text/30 px-4 py-3 text-sm text-foreground">
            {t(k("loadError"))}
          </p>
        )}
        {load.state === "ready" && solar.result && solar.source && outcome?.ok && (
          <div className="mb-8">
            <ElectricitySolarSummary
              result={solar.result}
              saving={comparison?.solarSaving ?? null}
              settings={solarSettings}
              source={solar.source}
              sortBy={form.sortBy}
            />
          </div>
        )}
        {load.state === "ready" && (
          <ElectricityTariffResults
            outcome={outcome && outcome.ok ? outcome.view : null}
            error={consumption && "error" in consumption ? t(k("errors.summary")) : engineError}
            source={load.source}
            option={form.option}
            sortBy={form.sortBy}
            socialTariffAsked={form.socialTariff}
            myTariffOn={form.myTariffOn}
            market={indexedPricing ? marketView : null}
            cheapestPerSupplier={form.cheapestPerSupplier}
            toolbar={toolbar}
            actions={shareButton}
          />
        )}
      </div>
    </div>
  );
}

function IndexedChoiceField({
  value,
  onChange,
  diagram,
  market,
  quarterHours,
  view,
}: {
  value: IndexedChoice;
  onChange: (value: IndexedChoice) => void;
  diagram: boolean;
  market: Async<unknown>["state"];
  quarterHours: Async<unknown>["state"];
  view: MarketView | null;
}) {
  const { t, locale } = useTranslations();
  const choices: { value: IndexedChoice; label: string }[] = [
    { value: "erse", label: t(k("indexed.erse")) },
    { value: "market", label: t(k(diagram ? "indexed.marketDiagram" : "indexed.market")) },
  ];
  const coverage = view?.basis.coverage;
  return (
    <fieldset className="space-y-2 border-t border-border pt-5">
      <legend className="sr-only">{t(k("indexed.legend"))}</legend>
      <p aria-hidden="true" className="text-sm font-medium text-foreground">
        {t(k("indexed.legend"))}
      </p>
      {choices.map((choice) => (
        <label key={choice.value} className="flex items-start gap-2 text-sm text-foreground">
          <input
            type="radio"
            name="tariff-indexed"
            value={choice.value}
            checked={value === choice.value}
            onChange={() => onChange(choice.value)}
            aria-describedby="tariff-indexed-help"
            className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span>{choice.label}</span>
        </label>
      ))}
      <FieldMessage id="tariff-indexed-help" className="pl-6">
        {t(k("indexed.help"))}
      </FieldMessage>
      {value === "market" && (market === "loading" || quarterHours === "loading") && (
        <FieldMessage tone="status" role="status" className="pl-6">
          {t(k("indexed.loading"))}
        </FieldMessage>
      )}
      {value === "market" && (market === "error" || (diagram && quarterHours === "error")) && (
        <FieldMessage tone="error" role="alert" className="pl-6">
          {t(k(market === "error" ? "indexed.loadError" : "indexed.diagramLoadError"))}
        </FieldMessage>
      )}
      {value === "market" && view?.diagramFallback === "outOfRange" && (
        <FieldMessage className="pl-6">{t(k("indexed.diagramOutOfRange"))}</FieldMessage>
      )}
      {value === "market" && view?.diagramFallback === "short" && (
        <FieldMessage className="pl-6">
          {t(k("indexed.diagramShort"), { months: String(view.diagramMonths ?? 0), minimum: String(MIN_DIAGRAM_MONTHS) })}
        </FieldMessage>
      )}
      {value === "market" && view && coverage !== undefined && coverage < 0.995 && (
        <FieldMessage className="pl-6">
          {t(k("indexed.coverage"), {
            percent: formatNumber(locale, coverage * 100, 0),
            period: monthRange(t, locale, view.basis.from, view.basis.to),
          })}
        </FieldMessage>
      )}
    </fieldset>
  );
}

function DiagramUpload({ diagram, onFile, onClear }: { diagram: Diagram; onFile: (file: File | undefined) => void; onClear: () => void }) {
  const { t, locale } = useTranslations();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <label htmlFor="tariff-diagram" className="block text-sm font-medium text-foreground">
        {t(k("diagram.label"))}
      </label>
      <input
        ref={input}
        id="tariff-diagram"
        type="file"
        accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        aria-describedby="tariff-diagram-help"
        onChange={(event) => onFile(event.currentTarget.files?.[0])}
        className="block w-full text-sm text-foreground file:mr-3 file:h-10 file:rounded-md file:border file:border-input file:bg-secondary file:px-4 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-paper-3"
      />
      <FieldMessage id="tariff-diagram-help">
        {t(k("diagram.help"))}
      </FieldMessage>
      <FieldMessage>{t(k("diagram.privacy"))}</FieldMessage>
      {diagram.state === "reading" && (
        <FieldMessage tone="status" role="status">
          {t(k("diagram.reading"))}
        </FieldMessage>
      )}
      {diagram.state === "error" && (
        <FieldMessage tone="error" role="alert">
          {diagram.message}
        </FieldMessage>
      )}
      {diagram.state === "ready" && (
        <div role="status" className="space-y-1 rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">
          <p>
            {t(k("diagram.loaded"), {
              first: diagram.summary.firstDay,
              last: diagram.summary.lastDay,
              days: String(diagram.summary.days),
              kwh: `${formatNumber(locale, diagram.summary.simple.energy, 0)} kWh`,
            })}
          </p>
          {diagram.summary.missingQuarters > 0 && (
            <p className="text-xs text-muted-foreground">
              {t(k("diagram.missing"), { count: formatNumber(locale, diagram.summary.missingQuarters, 0) })}
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              if (input.current) input.current.value = "";
              onClear();
            }}
            className="text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80"
          >
            {t(k("diagram.clear"))}
          </button>
        </div>
      )}
    </div>
  );
}

// The comparator's results: the comparison across tariff options, the visitor's own tariff, the
// ranked offers as dense rows (the monthly bill, the saving against the regulated tariff, the unit
// prices, the contract and a link to the offer), each with its breakdown and conditions, a tray
// that compares up to three offers side by side, the CSV export, the ERSE source note and the
// trademark line for the suppliers' logos. Indexed offers priced from OMIE's prices say so on their
// row and cite the supplier's formula.
import {
  ArrowUpRight,
  CalendarClock,
  Check,
  ChevronDown,
  Download,
  Flame,
  Info,
  Landmark,
  Leaf,
  Lock,
  Plug,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MarketView, OffersSource } from "./ElectricityTariffComparisonComp";
import type { ElectricityOffer } from "@/lib/calculators/electricityOfferTypes";
import { supplierName } from "@/lib/calculators/electricitySuppliers";
import {
  comparisonCsv,
  formatIsoDate,
  formatIsoMonth,
  MONTH_DAYS,
  type ComparatorView,
  type CsvLabels,
  type RankedOffer,
} from "@/lib/calculators/electricityTariffComparator";
import type { ComparisonSort, OfferComparison, TariffBreakdown, TariffOption } from "@/lib/calculators/electricityTariffComparison";
import { ERSE_TARIFFS } from "@/lib/calculators/data/erseTariffs";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber } from "@/lib/numberFormat";
import { useTranslations } from "@/lib/reactTranslations";
import BrandLogo from "@/components/shared/BrandLogo";
import TrademarkDisclaimer from "@/components/shared/TrademarkDisclaimer";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const k = (key: string) => `tools.electricityTariffComparison.${key}`;

/** The copy keys of each option's periods, in the order the engine and the invoice use. */
export const PERIOD_KEYS: Record<TariffOption, readonly string[]> = {
  simple: ["simple"],
  biHourly: ["offValley", "valley"],
  triHourly: ["peak", "shoulder", "valley"],
};

/** A span of months in words: one month alone, or "from to to" in the locale's words. */
export function monthRange(t: (key: string, values?: Record<string, string>) => string, locale: Lang, from: string, to: string) {
  if (from === to) return formatIsoMonth(locale, from);
  return t(k("indexed.range"), { from: formatIsoMonth(locale, from), to: formatIsoMonth(locale, to) });
}

const PAGE_SIZE = 20;
/** The most offers the side-by-side table holds. */
export const MAX_COMPARED = 3;
const OPTIONS: readonly TariffOption[] = ["simple", "biHourly", "triHourly"];
const linkClass = "font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80";
const secondaryButtonClass =
  "h-10 rounded-md border border-input bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-paper-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98] motion-reduce:active:scale-100";

interface Props {
  outcome: ComparatorView | null;
  error: string | undefined;
  source: OffersSource;
  option: TariffOption;
  sortBy: ComparisonSort;
  socialTariffAsked: boolean;
  myTariffOn: boolean;
  /** The OMIE basis indexed offers were priced on, or null for ERSE's estimate. */
  market?: MarketView | null;
  /** True when the list keeps only each supplier's cheapest offer. */
  cheapestPerSupplier?: boolean;
  /** The list's settings (view, supplier, price type, order and the quick filters), over the rows. */
  toolbar?: ReactNode;
  /** The actions beside the list's title before the CSV export (the share link). */
  actions?: ReactNode;
}

/** A translated sentence with its amount set in the figures' face (Geist Mono). */
function withAmount(text: string, amount: string): ReactNode {
  const at = text.indexOf(amount);
  if (at === -1) return text;
  return (
    <>
      {text.slice(0, at)}
      <span className="font-mono">{amount}</span>
      {text.slice(at + amount.length)}
    </>
  );
}

function useLabels() {
  const { t, locale } = useTranslations();
  /** "One month" for 365/12 days, "One year" for 365, otherwise "Your N days". */
  const periodLabel = (days: number) =>
    Math.abs(days - MONTH_DAYS) < 1e-9
      ? t(k("results.periodMonth"))
      : days === 365
        ? t(k("results.periodYear"))
        : t(k("results.period"), { days: formatNumber(locale, days, 0) });
  const euro = (value: number) => formatMoney(locale, value, { decimals: 2 });
  /** A unit price before VAT: four decimals, as suppliers and ERSE publish them. */
  const unit = (value: number) => formatNumber(locale, value, 4);
  const supplierOf = (offer: ElectricityOffer) => (offer.regulated ? t(k("regulatedSupplier")) : supplierName(offer.supplier));
  const optionLabel = (option: TariffOption) => t(k(`options.${option}`));
  return { t, locale, euro, unit, supplierOf, optionLabel, periodLabel };
}

/** "12-month contract", or "No fixed term" when ERSE gives no length. */
function contractLabel(t: (key: string, values?: Record<string, string>) => string, months: number | null) {
  if (!months) return t(k("row.noTerm"));
  return months === 1 ? t(k("row.contractMonthsOne")) : t(k("row.contractMonths"), { months: String(months) });
}

const rowKey = (result: OfferComparison) => `${result.offer.id}-${result.option}`;

/**
 * What the row compares the offer with, per month: the visitor's own tariff when they gave it,
 * else the regulated tariff. Positive: the offer costs less.
 */
function monthlyDelta(result: RankedOffer, view: ComparatorView, sortBy: ComparisonSort): { against: "mine" | "regulated"; amount: number } | null {
  if (result.saving !== null) return { against: "mine", amount: result.saving / 12 };
  if (!view.regulated || result.offer.regulated) return null;
  return { against: "regulated", amount: (view.regulated[sortBy].total - result[sortBy].total) / 12 };
}

export default function ElectricityTariffResults({
  outcome,
  error,
  source,
  option,
  sortBy,
  socialTariffAsked,
  myTariffOn,
  market = null,
  cheapestPerSupplier = false,
  toolbar,
  actions,
}: Props) {
  const { t, locale, supplierOf, optionLabel } = useLabels();
  const [shown, setShown] = useState(PAGE_SIZE);
  const [compared, setCompared] = useState<string[]>([]);
  const date = formatIsoDate(locale, source.exportedOn);

  // An offer the filters or the inputs took out of the list leaves the comparison too.
  const byKey = useMemo(() => new Map((outcome?.results ?? []).map((result) => [rowKey(result), result])), [outcome]);
  const selected = compared.map((key) => byKey.get(key)).filter((result): result is RankedOffer => result !== undefined);
  const toggleCompared = (key: string) =>
    setCompared((current) =>
      current.includes(key) ? current.filter((each) => each !== key) : current.length >= MAX_COMPARED ? current : [...current.filter((each) => byKey.has(each)), key],
    );

  const download = () => {
    if (!outcome) return;
    const labels: CsvLabels = {
      ...(t<Record<string, string>>(k("export.columns"), { returnObjects: true }) as unknown as Omit<CsvLabels, "options" | "yes" | "no" | "supplierOf" | "basisOf">),
      options: { simple: optionLabel("simple"), biHourly: optionLabel("biHourly"), triHourly: optionLabel("triHourly") },
      yes: t(k("export.yes")),
      no: t(k("export.no")),
      supplierOf,
      basisOf: (result) =>
        result.market
          ? t(k("export.basis.market"), { period: monthRange(t, locale, result.market.from, result.market.to) })
          : t(k(`export.basis.${result.priceBasis}`)),
    };
    const csv = comparisonCsv(outcome.results, locale, labels);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${t(k("export.filename"))}-${source.exportedOn}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      {error || !outcome ? (
        <>
          {toolbar}
          <p role="alert" className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">
            {error ?? t(k("errors.summary"))}
          </p>
        </>
      ) : (
        <>
          <OptionComparison outcome={outcome} option={option} sortBy={sortBy} />
          {socialTariffAsked && !outcome.socialTariffApplied && (
            <p className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">
              {t(k("results.socialNotApplied"), { kva: formatNumber(locale, ERSE_TARIFFS.socialTariff.upToKva, 1) })}
            </p>
          )}
          {myTariffOn && <MyTariffSummary outcome={outcome} sortBy={sortBy} />}

          <section aria-labelledby="tariff-results-title" className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="tariff-results-title" className="text-xl font-semibold tracking-tight text-foreground">
                  {t(k("results.title"), { option: optionLabel(option) })}
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground" aria-live="polite">
                  {t(k(cheapestPerSupplier ? "results.countPerSupplier" : "results.count"), {
                    count: formatNumber(locale, outcome.results.length, 0),
                    kwh: `${formatNumber(locale, outcome.annualKwh, 0)} kWh`,
                  })}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {actions}
                {outcome.results.length > 0 && (
                  <button type="button" onClick={download} className={cn(secondaryButtonClass, "inline-flex items-center gap-1.5")}>
                    <Download aria-hidden="true" className="size-4" />
                    {t(k("export.button"))}
                  </button>
                )}
              </div>
            </div>
            {toolbar}
            {market && estimatedCount(outcome) > 0 && (
              <p className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">
                {estimatedCount(outcome) === 1
                  ? t(k("results.estimatedLeftOne"))
                  : t(k("results.estimatedLeft"), { count: formatNumber(locale, estimatedCount(outcome), 0) })}
              </p>
            )}
            {outcome.results.length === 0 ? (
              <p className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">{t(k("results.none"))}</p>
            ) : (
              <>
                <ol className="space-y-3" aria-label={t(k("results.listLabel"))}>
                  {outcome.results.slice(0, shown).map((result, index) => (
                    <ResultRow
                      key={rowKey(result)}
                      result={result}
                      view={outcome}
                      rank={index + 1}
                      sortBy={sortBy}
                      compared={compared.includes(rowKey(result))}
                      compareFull={selected.length >= MAX_COMPARED}
                      onCompare={() => toggleCompared(rowKey(result))}
                    />
                  ))}
                </ol>
                {shown < outcome.results.length && (
                  <button
                    type="button"
                    onClick={() => setShown((current) => current + PAGE_SIZE)}
                    className="h-10 w-full rounded-md border border-input bg-background px-4 text-sm font-medium text-foreground hover:bg-paper-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t(k("results.showMore"), { count: formatNumber(locale, Math.min(PAGE_SIZE, outcome.results.length - shown), 0) })}
                  </button>
                )}
              </>
            )}
          </section>
          {selected.length > 0 && <CompareTray selected={selected} view={outcome} sortBy={sortBy} onClear={() => setCompared([])} />}
        </>
      )}
      <SourceNote source={source} date={date} market={market} />
      <TrademarkDisclaimer textKey="lp.trademarks.tmGeneric" />
    </div>
  );
}

/** The indexed offers in the list still on ERSE's estimate: no published formula to price them by. */
function estimatedCount(outcome: ComparatorView): number {
  return new Set(outcome.results.filter((result) => result.priceBasis === "erseEstimate").map((result) => result.offer.id)).size;
}

function OptionComparison({ outcome, option, sortBy }: { outcome: ComparatorView; option: TariffOption; sortBy: ComparisonSort }) {
  const { t, euro, supplierOf, optionLabel } = useLabels();
  const totals = OPTIONS.map((each) => outcome.best[each]?.[sortBy].total ?? Number.POSITIVE_INFINITY);
  const cheapest = Math.min(...totals);
  return (
    <section aria-labelledby="tariff-options-title" className="space-y-3">
      <h2 id="tariff-options-title" className="text-base font-semibold text-foreground">
        {t(k("compare.title"))}
      </h2>
      <ul className="grid grid-cols-3 gap-2 sm:gap-3">
        {OPTIONS.map((each, index) => {
          const best = outcome.best[each];
          const isCheapest = best !== null && totals[index] === cheapest;
          return (
            <li key={each} className={`min-w-0 rounded-card border bg-background p-3 sm:p-4 ${each === option ? "border-input" : "border-border"}`}>
              <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                {optionLabel(each)}
                {each === option && <span className="sr-only">{t(k("compare.yours"))}</span>}
              </p>
              {best ? (
                <>
                  {/* The amount never breaks; on a phone "/month" wraps under it rather than overflowing. */}
                  <p className="mt-1 font-mono text-lg font-semibold text-foreground max-sm:leading-tight sm:text-xl">
                    <span className="whitespace-nowrap">{euro(best[sortBy].total / 12)}</span>
                    <wbr />
                    <span className="ml-0.5 whitespace-nowrap font-sans text-xs font-normal text-muted-foreground">{t(k("row.perMonth"))}</span>
                  </p>
                  <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <BrandLogo name={supplierOf(best.offer)} className="size-4 rounded-sm text-[7px]" />
                    <span className="truncate">{supplierOf(best.offer)}</span>
                  </p>
                  {isCheapest ? (
                    <p className="mt-1 flex items-center gap-1 text-xs font-medium text-success-text">
                      <Check aria-hidden="true" className="size-3.5" />
                      {t(k("compare.cheapest"))}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {withAmount(t(k("compare.more"), { amount: euro(totals[index] - cheapest) }), euro(totals[index] - cheapest))}
                    </p>
                  )}
                  {/* The yearly figure the cards are compared on, for the tests and screen readers. */}
                  <p className="sr-only">{euro(best[sortBy].total)}</p>
                </>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">{t(k("compare.unavailable"))}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function MyTariffSummary({ outcome, sortBy }: { outcome: ComparatorView; sortBy: ComparisonSort }) {
  const { t, locale, euro } = useLabels();
  if (!outcome.mine) {
    return <p className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">{t(k("myTariff.incomplete"))}</p>;
  }
  const cheaper = outcome.results.filter((result) => (result.saving ?? 0) > 0.005);
  const best = cheaper[0];
  return (
    <section aria-labelledby="tariff-mine-title" className="space-y-2 rounded-card border border-border bg-background p-5">
      <h2 id="tariff-mine-title" className="text-lg font-semibold text-foreground">
        {t(k("myTariff.resultTitle"))}
      </h2>
      <p className="font-mono text-2xl font-semibold text-foreground">{euro(outcome.mine[sortBy].total)}</p>
      <p className="text-sm text-ink-2">{t(k(sortBy === "firstYear" ? "myTariff.yearly" : "myTariff.yearlyLater"))}</p>
      <p className="text-sm text-foreground">
        {best
          ? t(k("myTariff.cheaper"), { count: formatNumber(locale, cheaper.length, 0), saving: euro(best.saving ?? 0) })
          : t(k("myTariff.noneCheaper"))}
      </p>
    </section>
  );
}

/** The few traits that change a decision, each with its icon; the rest are in the details. */
function badges(result: RankedOffer, t: (key: string) => string) {
  const { offer } = result;
  const list: { key: string; label: string; tone: "warning" | "neutral"; Icon: LucideIcon }[] = [];
  if (result.estimated) list.push({ key: "estimated", label: t(k("badges.estimated")), tone: "warning", Icon: TrendingUp });
  if (result.priceBasis === "market") list.push({ key: "market", label: t(k("badges.market")), tone: "neutral", Icon: TrendingUp });
  if (offer.regulated) list.push({ key: "regulated", label: t(k("badges.regulated")), tone: "neutral", Icon: Landmark });
  if (offer.conditioned) list.push({ key: "conditioned", label: t(k("badges.conditioned")), tone: "warning", Icon: UserCheck });
  if (result.dual) list.push({ key: "dual", label: t(k("badges.dual")), tone: "neutral", Icon: Flame });
  if (offer.loyalty) list.push({ key: "loyalty", label: t(k("badges.loyalty")), tone: "warning", Icon: Lock });
  if (offer.mandatoryServicesPerYear > 0) list.push({ key: "services", label: t(k("badges.services")), tone: "neutral", Icon: Wrench });
  if (offer.renewable) list.push({ key: "renewable", label: t(k("badges.renewable")), tone: "neutral", Icon: Leaf });
  return list;
}

/** The offer's unit prices before VAT, energy per period and power per day, and its contract. */
function UnitPrices({ result }: { result: OfferComparison }) {
  const { t, unit } = useLabels();
  const periods = PERIOD_KEYS[result.option];
  const item = "flex items-center gap-1.5 whitespace-nowrap";
  return (
    <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-2">
      <div className={item}>
        <dt>
          <Zap aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <span className="sr-only">{t(k("row.energy"))}</span>
        </dt>
        <dd>
          {result.prices.energy.map((price, index) => (
            <span key={periods[index]}>
              {index > 0 && <span aria-hidden="true" className="text-muted-foreground"> / </span>}
              <span className="font-mono text-foreground">{unit(price)}</span>
            </span>
          ))}
          <span className="ml-1 text-xs text-muted-foreground">€/kWh</span>
        </dd>
      </div>
      <div className={item}>
        <dt>
          <Plug aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <span className="sr-only">{t(k("row.power"))}</span>
        </dt>
        <dd>
          <span className="font-mono text-foreground">{unit(result.prices.powerPerDay)}</span>
          <span className="ml-1 text-xs text-muted-foreground">{t(k("row.perDayShort"))}</span>
        </dd>
      </div>
      <div className={item}>
        <dt>
          <CalendarClock aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <span className="sr-only">{t(k("row.conditions.duration"))}</span>
        </dt>
        <dd className="text-xs">{contractLabel(t, result.offer.durationMonths)}</dd>
      </div>
    </dl>
  );
}

function ResultRow({
  result,
  view,
  rank,
  sortBy,
  compared,
  compareFull,
  onCompare,
}: {
  result: RankedOffer;
  view: ComparatorView;
  rank: number;
  sortBy: ComparisonSort;
  compared: boolean;
  compareFull: boolean;
  onCompare: () => void;
}) {
  const { t, locale, euro, supplierOf } = useLabels();
  const [open, setOpen] = useState(false);
  const { offer } = result;
  const supplier = supplierOf(offer);
  const link = offer.links.offer ?? offer.links.supplier;
  const delta = monthlyDelta(result, view, sortBy);
  const detailsId = `tariff-row-${rowKey(result)}`;
  const compareId = `tariff-compare-${rowKey(result)}`;
  const list = badges(result, t);

  return (
    <li className={`overflow-hidden rounded-card border bg-background ${compared ? "border-primary/50" : "border-border"}`}>
      <div className="flex gap-3 p-4 sm:gap-4 sm:px-5">
        <div className="relative shrink-0">
          <BrandLogo name={supplier} className="size-10 text-sm" />
          <span className="absolute -left-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-background text-[0.6875rem] font-medium text-ink-2">
            {rank}
          </span>
        </div>
        <div className="min-w-0 flex-1 space-y-2.5">
          {/* On a phone the wrappers dissolve into one grid: the supplier and the month on a line, the
              saving under the month, then the offer's name across the row. From sm, two columns. */}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 sm:flex sm:items-start sm:justify-between">
            <div className="contents sm:block sm:min-w-0">
              <p className="col-start-1 row-start-1 text-sm font-semibold text-foreground">{supplier}</p>
              <p className="col-span-2 row-start-3 line-clamp-2 break-words text-sm text-ink-2" title={offer.name}>
                {offer.name}
              </p>
            </div>
            <div className="contents sm:block sm:shrink-0 sm:text-right">
              <p className={`col-start-2 row-start-1 whitespace-nowrap text-right font-mono text-xl font-semibold leading-tight sm:text-2xl ${rank === 1 ? "text-primary" : "text-foreground"}`}>
                {euro(result[sortBy].total / 12)}
                <span className="ml-0.5 font-sans text-xs font-normal text-muted-foreground">{t(k("row.perMonth"))}</span>
              </p>
              {delta && Math.abs(delta.amount) > 0.005 && (
                <p className={`col-span-2 row-start-2 flex items-center justify-end gap-1 whitespace-nowrap text-xs ${delta.amount > 0 ? "text-success-text" : "text-muted-foreground"}`}>
                  {delta.amount > 0 ? <TrendingDown aria-hidden="true" className="size-3.5" /> : <TrendingUp aria-hidden="true" className="size-3.5" />}
                  {withAmount(t(k(`row.${delta.amount > 0 ? "cheaper" : "dearer"}.${delta.against}`), { amount: euro(Math.abs(delta.amount)) }), euro(Math.abs(delta.amount)))}
                </p>
              )}
              {delta && Math.abs(delta.amount) <= 0.005 && <p className="col-span-2 row-start-2 text-right text-xs text-muted-foreground">{t(k(`row.same.${delta.against}`))}</p>}
              {/* The year the row is ranked on, for the tests and screen readers; the details show it too. */}
              <p className="sr-only">{euro(result[sortBy].total)}</p>
            </div>
          </div>
          {list.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label={t(k("badges.label"))}>
              {list.map(({ key, label, tone, Icon }) => (
                <li
                  key={key}
                  className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs ${tone === "warning" ? "bg-warning/15 text-warning-text" : "bg-paper-2 text-ink-2"}`}
                >
                  <Icon aria-hidden="true" className="size-3" />
                  {label}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <UnitPrices result={result} />
            <div className="flex items-center gap-3">
              <label htmlFor={compareId} className="flex cursor-pointer items-center gap-1.5 text-sm text-ink-2 hover:text-foreground">
                <input
                  id={compareId}
                  type="checkbox"
                  checked={compared}
                  disabled={!compared && compareFull}
                  onChange={onCompare}
                  className="size-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
                  aria-label={t(k("row.compareOffer"), { offer: offer.name })}
                />
                <span aria-hidden="true">{t(k("row.compare"))}</span>
              </label>
              {link && (
                <a href={link} rel="noopener nofollow" target="_blank" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1")}>
                  {t(k("row.goTo"), { supplier })}
                  <ArrowUpRight aria-hidden="true" className="size-4" />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-center gap-1 border-t border-border-2 px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-paper-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {t(k(open ? "results.detailsClose" : "results.details"))}
        <ChevronDown aria-hidden="true" className={`size-3.5 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </button>
      <div id={detailsId} hidden={!open} className="border-t border-border bg-paper-2 px-4 py-5 sm:px-5">
        <RowDetails result={result} locale={locale} />
      </div>
    </li>
  );
}

function RowDetails({ result, locale }: { result: RankedOffer; locale: Lang }) {
  const { t, euro } = useLabels();
  const { offer } = result;
  const links = (["offer", "standardSheet", "terms"] as const).filter((key) => offer.links[key]);
  const yes = t(k("row.yes"));
  const no = t(k("row.no"));
  const conditions: { key: string; value: ReactNode }[] = [
    { key: "pricing", value: t(k(`row.pricing.${offer.indexed ? "indexed" : "fixed"}`)) },
    { key: "duration", value: contractLabel(t, offer.durationMonths) },
    { key: "loyalty", value: offer.loyalty ? yes : no },
    { key: "directDebit", value: offer.requirements.directDebit ? t(k("row.required")) : t(k("row.notRequired")) },
    { key: "eInvoice", value: offer.requirements.eInvoice ? t(k("row.required")) : t(k("row.notRequired")) },
    { key: "renewable", value: offer.renewable ? yes : no },
    { key: "conditioned", value: offer.conditioned ? yes : no },
    ...(offer.mandatoryServicesPerYear > 0
      ? [{ key: "services", value: <span className="font-mono">{euro(offer.mandatoryServicesPerYear)}</span> }]
      : []),
    {
      key: "valid",
      value: offer.validTo
        ? t(k("row.validRange"), { from: formatIsoDate(locale, offer.validFrom), to: formatIsoDate(locale, offer.validTo) })
        : t(k("row.validFrom"), { from: formatIsoDate(locale, offer.validFrom) }),
    },
  ];

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="min-w-0 space-y-5">
        <h3 className="text-sm font-semibold text-foreground">
          {withAmount(t(k("row.howTotal"), { amount: euro(result.firstYear.total) }), euro(result.firstYear.total))}
        </h3>
        <MoneyBar bill={result.firstYear} />
        <Breakdown result={result} />
      </div>
      <div className="min-w-0 space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t(k("row.conditionsTitle"))}</h3>
          <dl className="mt-2 divide-y divide-border-2 text-sm">
            {conditions.map((line) => (
              <div key={line.key} className="flex items-baseline justify-between gap-4 py-1.5">
                <dt className="text-ink-2">{t(k(`row.conditions.${line.key}`))}</dt>
                <dd className="text-right text-foreground">{line.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        {result.estimated && <p className="text-xs text-warning-text">{t(k("results.estimatedNote"))}</p>}
        {result.market && (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              {t(k(result.market.kind === "diagram" ? "results.marketDiagramNote" : "results.marketNote"), {
                period: monthRange(t, locale, result.market.from, result.market.to),
              })}
            </p>
            <p>
              {t(k("results.marketPrices"), {
                prices: result.market.energy
                  .map((price, index) =>
                    result.option === "simple"
                      ? `${formatNumber(locale, price, 4)} €/kWh`
                      : `${t(k(`periods.${PERIOD_KEYS[result.option][index]}`))} ${formatNumber(locale, price, 4)} €/kWh`,
                  )
                  .join(" · "),
              })}
            </p>
            {/* The formula's first source is the supplier's own document it was read from. */}
            <p>
              <a href={result.market.formula.sources[0].url} rel="noopener nofollow" target="_blank" className={linkClass}>
                {t(k("results.formulaLink"), { date: formatIsoDate(locale, result.market.formula.sources[0].readOn) })}
              </a>
            </p>
          </div>
        )}
        {(offer.conditions || offer.notes) && (
          <div className="text-xs text-muted-foreground">
            <p className="font-medium">{t(k("results.conditionsLabel"))}</p>
            {/* Verbatim Portuguese text from ERSE's export: not translated. */}
            <p lang="pt-PT" className="whitespace-pre-line break-words">
              {[offer.conditions, offer.notes].filter(Boolean).join("\n")}
            </p>
          </div>
        )}
        {links.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {links.map((key) => (
              <li key={key}>
                <a href={offer.links[key]} rel="noopener nofollow" target="_blank" className={linkClass}>
                  {t(k(`results.links.${key}`))}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Where a year's bill goes: power, energy, taxes and services, as one bar in the chart slots. */
function MoneyBar({ bill }: { bill: TariffBreakdown }) {
  const { t, euro, locale } = useLabels();
  const parts = [
    { key: "power", value: bill.power, slot: 1 },
    { key: "energy", value: bill.energy, slot: 5 },
    { key: "taxes", value: bill.cav + bill.iec + bill.vatReduced + bill.vatStandard, slot: 2 },
    { key: "services", value: bill.services, slot: 3 },
  ].filter((part) => part.value > 0.005);
  const discounts = bill.refunds + bill.newClientDiscount;
  const sum = parts.reduce((total, part) => total + part.value, 0);
  if (sum <= 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t(k("row.moneyTitle"))}</p>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-paper-3" aria-hidden="true">
        {parts.map((part) => (
          <span key={part.key} className="h-full" style={{ width: `${(part.value / sum) * 100}%`, background: `oklch(var(--chart-${part.slot}))` }} />
        ))}
      </div>
      <ul className="space-y-1 text-sm">
        {parts.map((part) => (
          <li key={part.key} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-ink-2">
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm" style={{ background: `oklch(var(--chart-${part.slot}))` }} />
              {t(k(`row.money.${part.key}`))}
            </span>
            <span className="whitespace-nowrap font-mono text-foreground">
              {euro(part.value)} <span className="text-xs text-muted-foreground">{formatNumber(locale, (part.value / sum) * 100, 0)}%</span>
            </span>
          </li>
        ))}
        {discounts < -0.005 && (
          <li className="flex items-center justify-between gap-3">
            <span className="pl-[1.125rem] text-ink-2">{t(k("row.money.discounts"))}</span>
            <span className="whitespace-nowrap font-mono text-success-text">{euro(discounts)}</span>
          </li>
        )}
      </ul>
    </div>
  );
}

const LINES: readonly (keyof TariffBreakdown)[] = [
  "power",
  "energy",
  "socialDiscount",
  "cav",
  "iec",
  "services",
  "refunds",
  "newClientDiscount",
  "subtotal",
  "vatReduced",
  "vatStandard",
  "total",
];


function Breakdown({ result }: { result: RankedOffer }) {
  const { t, euro, periodLabel } = useLabels();
  const shown = LINES.filter(
    (line) => !["socialDiscount", "services", "refunds", "newClientDiscount"].includes(line) || Math.abs(result.firstYear[line]) > 0.0049,
  );
  // The first year always; the entered days only when they are not a month (the row shows that),
  // and later years only when a new-client discount makes them differ.
  const columns = [
    ...(Math.abs(result.period.days - MONTH_DAYS) > 1e-9 ? [{ key: "period", label: periodLabel(result.period.days), bill: result.period }] : []),
    { key: "firstYear", label: t(k("results.firstYear")), bill: result.firstYear },
    ...(Math.abs(result.laterYears.total - result.firstYear.total) > 0.005 ? [{ key: "laterYears", label: t(k("results.laterYears")), bill: result.laterYears }] : []),
  ];
  const energyPeriods = PERIOD_KEYS[result.option].length;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{t(k("results.breakdownCaption"), { offer: result.offer.name })}</caption>
        <thead className="text-muted-foreground">
          <tr>
            <th scope="col" className="py-2 pr-2 text-left font-medium">
              {t(k("lines.item"))}
            </th>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={`whitespace-nowrap px-2 py-2 text-right font-medium last:pr-0`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((line) => (
            <tr key={line} className={`border-t border-border-2 ${line === "total" ? "font-semibold" : ""}`}>
              <th scope="row" className="py-1.5 pr-2 text-left font-normal text-foreground">
                {t(k(`lines.${line}`), { periods: String(energyPeriods) })}
              </th>
              {columns.map((column) => (
                <td key={column.key} className={`whitespace-nowrap px-2 py-1.5 text-right font-mono text-foreground last:pr-0`}>
                  {euro(line === "socialDiscount" ? -column.bill[line] : column.bill[line])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The bar of the offers picked to compare, and the side-by-side table it opens. */
function CompareTray({ selected, view, sortBy, onClear }: { selected: RankedOffer[]; view: ComparatorView; sortBy: ComparisonSort; onClear: () => void }) {
  const { t, locale } = useLabels();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    }
    if (!open && element.open) {
      if (typeof element.close === "function") element.close();
      else element.removeAttribute("open");
    }
  }, [open]);
  return (
    <>
      <div
        role="region"
        aria-label={t(k("compareTray.label"))}
        className="fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 rounded-card border border-input bg-background px-4 py-3 shadow-lg sm:inset-x-0"
      >
        <p className="text-sm text-foreground">
          {t(k(selected.length === 1 ? "compareTray.countOne" : "compareTray.count"), { count: formatNumber(locale, selected.length, 0), max: String(MAX_COMPARED) })}
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={onClear} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            {t(k("compareTray.clear"))}
          </button>
          <button type="button" onClick={() => setOpen(true)} disabled={selected.length < 2} className={cn(buttonVariants({ size: "sm" }))}>
            {t(k("compareTray.open"))}
          </button>
        </div>
      </div>
      <dialog
        ref={dialog}
        aria-labelledby="tariff-compare-title"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
        className="m-auto w-[min(56rem,calc(100vw-2rem))] max-w-none rounded-card border border-border bg-background p-0 text-foreground shadow-lg backdrop:bg-[oklch(var(--overlay)/0.45)]"
      >
        {open && (
          <div className="max-h-[85dvh] overflow-auto p-5 sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2 id="tariff-compare-title" className="text-lg font-semibold">
                {t(k("compareTray.title"))}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t(k("compareTray.close"))}
                className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "-mr-2 -mt-2")}
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
            <CompareTable selected={selected} view={view} sortBy={sortBy} />
          </div>
        )}
      </dialog>
    </>
  );
}

function CompareTable({ selected, view, sortBy }: { selected: RankedOffer[]; view: ComparatorView; sortBy: ComparisonSort }) {
  const { t, euro, unit, supplierOf } = useLabels();
  const yes = t(k("row.yes"));
  const no = t(k("row.no"));
  const cheapest = Math.min(...selected.map((result) => result[sortBy].total));
  const option = selected[0].option;
  const rows: { key: string; label: string; cells: (result: RankedOffer) => ReactNode; group?: string }[] = [
    { key: "month", label: t(k("results.periodMonth")), cells: (result) => euro(result[sortBy].total / 12) },
    { key: "firstYear", label: t(k("results.firstYear")), cells: (result) => euro(result.firstYear.total) },
    { key: "laterYears", label: t(k("results.laterYears")), cells: (result) => euro(result.laterYears.total) },
    {
      key: "vsCheapest",
      label: t(k("compareTray.vsCheapest")),
      cells: (result) => (result[sortBy].total - cheapest < 0.005 ? "—" : `+${euro(result[sortBy].total - cheapest)}`),
    },
    ...(view.regulated
      ? [
          {
            key: "vsRegulated",
            label: t(k("compareTray.vsRegulated")),
            cells: (result: RankedOffer) => euro((view.regulated![sortBy].total - result[sortBy].total) / 12),
          },
        ]
      : []),
    { key: "power", label: `${t(k("row.power"))} (${t(k("row.perDayShort"))})`, cells: (result) => unit(result.prices.powerPerDay), group: t(k("compareTray.unitPrices")) },
    ...PERIOD_KEYS[option].map((period, index) => ({
      key: `energy-${period}`,
      label: `${PERIOD_KEYS[option].length > 1 ? t(k(`periods.${period}`)) : t(k("row.energy"))} (€/kWh)`,
      cells: (result: RankedOffer) => unit(result.prices.energy[index]),
    })),
    { key: "pricing", label: t(k("row.conditions.pricing")), cells: (result) => t(k(`row.pricing.${result.offer.indexed ? "indexed" : "fixed"}`)), group: t(k("row.conditionsTitle")) },
    {
      key: "duration",
      label: t(k("row.conditions.duration")),
      cells: (result) => (contractLabel(t, result.offer.durationMonths)),
    },
    { key: "loyalty", label: t(k("row.conditions.loyalty")), cells: (result) => (result.offer.loyalty ? yes : no) },
    { key: "directDebit", label: t(k("row.conditions.directDebit")), cells: (result) => (result.offer.requirements.directDebit ? t(k("row.required")) : t(k("row.notRequired"))) },
    { key: "eInvoice", label: t(k("row.conditions.eInvoice")), cells: (result) => (result.offer.requirements.eInvoice ? t(k("row.required")) : t(k("row.notRequired"))) },
    { key: "renewable", label: t(k("row.conditions.renewable")), cells: (result) => (result.offer.renewable ? yes : no) },
    { key: "conditioned", label: t(k("row.conditions.conditioned")), cells: (result) => (result.offer.conditioned ? yes : no) },
  ];
  const figures = new Set(["month", "firstYear", "laterYears", "vsCheapest", "vsRegulated", "power", ...PERIOD_KEYS[option].map((period) => `energy-${period}`)]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-sm">
        <caption className="sr-only">{t(k("compareTray.title"))}</caption>
        <thead>
          <tr>
            <td className="w-1/4" />
            {selected.map((result) => (
              <th key={rowKey(result)} scope="col" className="px-3 pb-3 text-left align-bottom font-normal">
                <span className="flex items-center gap-2 font-semibold text-foreground">
                  <BrandLogo name={supplierOf(result.offer)} />
                  {supplierOf(result.offer)}
                </span>
                <span className="block text-xs text-muted-foreground">{result.offer.name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-border-2">
              <th scope="row" className="py-2 pr-3 text-left align-top font-normal text-ink-2">
                {row.group && <span className="mb-1 block text-xs font-medium text-muted-foreground">{row.group}</span>}
                {row.label}
              </th>
              {selected.map((result) => (
                <td
                  key={rowKey(result)}
                  className={cn(
                    "px-3 py-2 align-bottom text-foreground",
                    figures.has(row.key) && "whitespace-nowrap font-mono",
                    row.key === "month" && result[sortBy].total - cheapest < 0.005 && "font-semibold text-primary",
                  )}
                >
                  {row.cells(result)}
                </td>
              ))}
            </tr>
          ))}
          <tr className="border-t border-border-2">
            <td />
            {selected.map((result) => {
              const link = result.offer.links.offer ?? result.offer.links.supplier;
              return (
                <td key={rowKey(result)} className="px-3 pt-3">
                  {link && (
                    <a href={link} rel="noopener nofollow" target="_blank" className={linkClass}>
                      {t(k("results.links.offer"))}
                    </a>
                  )}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SourceNote({ source, date, market }: { source: OffersSource; date: string; market: MarketView | null }) {
  const { t, locale } = useTranslations();
  return (
    <details className="group rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <Info aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1">
          {t(k("source.asOf"), {
            date,
            offers: formatNumber(locale, source.offerCount, 0),
            suppliers: formatNumber(locale, source.supplierCount - 1, 0),
          })}
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="mt-3 space-y-2 pl-6">
        <ul className="list-disc space-y-1 pl-5 text-ink-2">
          <li>{t(k("source.negotiation"))}</li>
          <li>
            {market
              ? t(k(market.basis.kind === "diagram" ? "source.indexedMarketDiagram" : "source.indexedMarket"), {
                  period: monthRange(t, locale, market.basis.from, market.basis.to),
                })
              : t(k("source.indexed"))}
          </li>
          <li>{t(k("source.taxes"))}</li>
          <li>{t(k("source.dgeg"))}</li>
          <li>{t(k("source.educational"))}</li>
        </ul>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <a href={source.url} rel="noopener" target="_blank" className={linkClass}>
            {t(k("source.simulatorLink"))}
          </a>
          {market && (
            <>
              <a href={market.source.url} rel="noopener" target="_blank" className={linkClass}>
                {t(k("source.omieLink"))}
              </a>
              <a href={market.source.profilesUrl} rel="noopener" target="_blank" className={linkClass}>
                {t(k("source.profilesLink"))}
              </a>
            </>
          )}
        </p>
      </div>
    </details>
  );
}

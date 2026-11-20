// The comparator's results: the comparison across tariff options, the visitor's own tariff, the
// ranked offers with their breakdown and links, the CSV export and the ERSE source note. Indexed
// offers priced from OMIE's prices say so on their card and cite the supplier's formula.
import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
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
import type { ComparisonSort, TariffBreakdown, TariffOption } from "@/lib/calculators/electricityTariffComparison";
import { ERSE_TARIFFS } from "@/lib/calculators/data/erseTariffs";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber } from "@/lib/numberFormat";
import { useTranslations } from "@/lib/reactTranslations";

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
const OPTIONS: readonly TariffOption[] = ["simple", "biHourly", "triHourly"];
const linkClass = "font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80";

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
  const supplierOf = (offer: ElectricityOffer) => (offer.regulated ? t(k("regulatedSupplier")) : supplierName(offer.supplier));
  const optionLabel = (option: TariffOption) => t(k(`options.${option}`));
  return { t, locale, euro, supplierOf, optionLabel, periodLabel };
}

export default function ElectricityTariffResults({ outcome, error, source, option, sortBy, socialTariffAsked, myTariffOn, market = null }: Props) {
  const { t, locale, supplierOf, optionLabel } = useLabels();
  const [shown, setShown] = useState(PAGE_SIZE);
  const date = formatIsoDate(locale, source.exportedOn);

  const download = () => {
    if (!outcome) return;
    const labels: CsvLabels = {
      ...(t<Record<string, string>>(k("export.columns"), { returnObjects: true }) as unknown as Omit<CsvLabels, "options" | "yes" | "no" | "supplierOf">),
      options: { simple: optionLabel("simple"), biHourly: optionLabel("biHourly"), triHourly: optionLabel("triHourly") },
      yes: t(k("export.yes")),
      no: t(k("export.no")),
      supplierOf,
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
        <p role="alert" className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">
          {error ?? t(k("errors.summary"))}
        </p>
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
                <h2 id="tariff-results-title" className="text-2xl font-semibold tracking-tight text-foreground">
                  {t(k("results.title"), { option: optionLabel(option) })}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
                  {t(k("results.count"), {
                    count: formatNumber(locale, outcome.results.length, 0),
                    kwh: `${formatNumber(locale, outcome.annualKwh, 0)} kWh`,
                  })}
                </p>
              </div>
              {outcome.results.length > 0 && (
                <button
                  type="button"
                  onClick={download}
                  className="h-10 rounded-md border border-input bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-paper-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98] motion-reduce:active:scale-100"
                >
                  {t(k("export.button"))}
                </button>
              )}
            </div>
            {outcome.results.length === 0 ? (
              <p className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">{t(k("results.none"))}</p>
            ) : (
              <>
                <ol className="space-y-3" aria-label={t(k("results.listLabel"))}>
                  {outcome.results.slice(0, shown).map((result, index) => (
                    <ResultCard key={`${result.offer.id}-${result.option}`} result={result} rank={index + 1} sortBy={sortBy} />
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
        </>
      )}
      <SourceNote source={source} date={date} market={market} />
    </div>
  );
}

function OptionComparison({ outcome, option, sortBy }: { outcome: ComparatorView; option: TariffOption; sortBy: ComparisonSort }) {
  const { t, euro, supplierOf, optionLabel } = useLabels();
  const totals = OPTIONS.map((each) => outcome.best[each]?.[sortBy].total ?? Number.POSITIVE_INFINITY);
  const cheapest = Math.min(...totals);
  return (
    <section aria-labelledby="tariff-options-title" className="space-y-3">
      <h2 id="tariff-options-title" className="text-lg font-semibold text-foreground">
        {t(k("compare.title"))}
      </h2>
      <p className="text-sm text-ink-2">{t(k("compare.intro"))}</p>
      <ul className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map((each, index) => {
          const best = outcome.best[each];
          const isCheapest = best !== null && totals[index] === cheapest;
          return (
            <li key={each} className={`rounded-card border bg-background p-4 ${each === option ? "border-input" : "border-border"}`}>
              <p className="text-sm font-medium text-foreground">
                {optionLabel(each)}
                {each === option && <span className="ml-1 font-normal text-muted-foreground">{t(k("compare.yours"))}</span>}
              </p>
              {best ? (
                <>
                  <p className="mt-2 font-mono text-xl font-semibold text-foreground">
                    {euro(best[sortBy].total)}
                  </p>
                  <p className="text-xs text-muted-foreground">{t(k(sortBy === "firstYear" ? "compare.perFirstYear" : "compare.perLaterYear"))}</p>
                  <p className="mt-2 text-sm text-foreground">{supplierOf(best.offer)}</p>
                  <p className="text-xs text-muted-foreground">{best.offer.name}</p>
                  {isCheapest ? (
                    <p className="mt-2 text-xs font-medium text-success-text">{t(k("compare.cheapest"))}</p>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {withAmount(t(k("compare.more"), { amount: euro(totals[index] - cheapest) }), euro(totals[index] - cheapest))}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">{t(k("compare.unavailable"))}</p>
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

function badges(result: RankedOffer, t: (key: string) => string) {
  const { offer } = result;
  const list: { key: string; label: string; tone: "warning" | "neutral" }[] = [];
  if (result.estimated) list.push({ key: "estimated", label: t(k("badges.estimated")), tone: "warning" });
  if (result.priceBasis === "market") list.push({ key: "market", label: t(k("badges.market")), tone: "neutral" });
  if (offer.regulated) list.push({ key: "regulated", label: t(k("badges.regulated")), tone: "neutral" });
  if (offer.conditioned) list.push({ key: "conditioned", label: t(k("badges.conditioned")), tone: "neutral" });
  if (result.dual) list.push({ key: "dual", label: t(k("badges.dual")), tone: "neutral" });
  if (offer.loyalty) list.push({ key: "loyalty", label: t(k("badges.loyalty")), tone: "neutral" });
  if (offer.renewable) list.push({ key: "renewable", label: t(k("badges.renewable")), tone: "neutral" });
  if (offer.requirements.directDebit) list.push({ key: "directDebit", label: t(k("badges.directDebit")), tone: "neutral" });
  if (offer.requirements.eInvoice) list.push({ key: "eInvoice", label: t(k("badges.eInvoice")), tone: "neutral" });
  if (offer.mandatoryServicesPerYear > 0) list.push({ key: "services", label: t(k("badges.services")), tone: "neutral" });
  return list;
}

function ResultCard({ result, rank, sortBy }: { result: RankedOffer; rank: number; sortBy: ComparisonSort }) {
  const { t, locale, euro, supplierOf, periodLabel } = useLabels();
  const { offer } = result;
  const other: ComparisonSort = sortBy === "firstYear" ? "laterYears" : "firstYear";
  const links = (["offer", "standardSheet", "terms"] as const).filter((key) => offer.links[key]);
  return (
    <li className="rounded-card border border-border bg-background p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            <span>{rank}</span>
            <span aria-hidden="true"> · </span>
            <span className="font-medium text-foreground">{supplierOf(offer)}</span>
          </p>
          <p className="mt-0.5 break-words text-sm text-ink-2">{offer.name}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`font-mono text-xl font-semibold ${rank === 1 ? "text-primary" : "text-foreground"}`}>{euro(result[sortBy].total)}</p>
          <p className="text-xs text-muted-foreground">{t(k(`results.${sortBy}`))}</p>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{t(k(`results.${other}`))}</dt>
          <dd className="font-mono text-foreground">{euro(result[other].total)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{periodLabel(result.period.days)}</dt>
          <dd className="font-mono text-foreground">{euro(result.period.total)}</dd>
        </div>
      </dl>
      {result.saving !== null && (
        <p className={`mt-2 text-sm ${result.saving > 0.005 ? "text-success-text" : "text-muted-foreground"}`}>
          {result.saving > 0.005
            ? withAmount(t(k("results.saving"), { amount: euro(result.saving) }), euro(result.saving))
            : result.saving < -0.005
              ? withAmount(t(k("results.dearer"), { amount: euro(-result.saving) }), euro(-result.saving))
              : t(k("results.same"))}
        </p>
      )}
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t(k("badges.label"))}>
        {badges(result, t).map((badge) => (
          <li
            key={badge.key}
            className={`rounded-sm px-1.5 py-0.5 text-xs ${badge.tone === "warning" ? "bg-warning/15 text-warning-text" : "bg-paper-2 text-ink-2"}`}
          >
            {badge.label}
          </li>
        ))}
      </ul>
      <details className="group mt-3">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          {t(k("results.details"))}
          <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="mt-3 space-y-3">
          <Breakdown result={result} />
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
      </details>
    </li>
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

/** The period's column repeats the card's figure; phones show the two yearly columns only. */
const hiddenOnPhone = (key: string) => (key === "period" ? "hidden sm:table-cell" : "");

function Breakdown({ result }: { result: RankedOffer }) {
  const { t, euro, periodLabel } = useLabels();
  const shown = LINES.filter(
    (line) => !["socialDiscount", "services", "refunds", "newClientDiscount"].includes(line) || Math.abs(result.firstYear[line]) > 0.0049,
  );
  const columns = [
    { key: "period", label: periodLabel(result.period.days), bill: result.period },
    { key: "firstYear", label: t(k("results.firstYear")), bill: result.firstYear },
    { key: "laterYears", label: t(k("results.laterYears")), bill: result.laterYears },
  ];
  const energyPeriods = PERIOD_KEYS[result.option].length;
  return (
    <div className="-mx-4 overflow-x-auto border-y border-border-2 sm:-mx-5">
      <table className="w-full text-sm">
        <caption className="sr-only">{t(k("results.breakdownCaption"), { offer: result.offer.name })}</caption>
        <thead className="bg-paper-2 text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2 text-left font-medium sm:px-5">
              {t(k("lines.item"))}
            </th>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={`whitespace-nowrap px-2 py-2 text-right font-medium last:pr-4 sm:px-3 sm:last:pr-5 ${hiddenOnPhone(column.key)}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((line) => (
            <tr key={line} className={`border-t border-border-2 ${line === "total" ? "font-semibold" : ""}`}>
              <th scope="row" className="px-4 py-2 text-left font-normal text-foreground sm:px-5">
                {t(k(`lines.${line}`), { periods: String(energyPeriods) })}
              </th>
              {columns.map((column) => (
                <td key={column.key} className={`whitespace-nowrap px-2 py-2 text-right font-mono text-foreground last:pr-4 sm:px-3 sm:last:pr-5 ${hiddenOnPhone(column.key)}`}>
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

function SourceNote({ source, date, market }: { source: OffersSource; date: string; market: MarketView | null }) {
  const { t, locale } = useTranslations();
  return (
    <div className="space-y-2 rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">
      <p className="font-semibold">
        {t(k("source.asOf"), {
          date,
          offers: formatNumber(locale, source.offerCount, 0),
          suppliers: formatNumber(locale, source.supplierCount - 1, 0),
        })}
      </p>
      <ul className="list-disc space-y-1 pl-5">
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
      <p>
        <a href={source.url} rel="noopener" target="_blank" className={linkClass}>
          {t(k("source.simulatorLink"))}
        </a>
      </p>
      {market && (
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <a href={market.source.url} rel="noopener" target="_blank" className={linkClass}>
            {t(k("source.omieLink"))}
          </a>
          <a href={market.source.profilesUrl} rel="noopener" target="_blank" className={linkClass}>
            {t(k("source.profilesLink"))}
          </a>
        </p>
      )}
    </div>
  );
}

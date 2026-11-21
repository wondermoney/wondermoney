import { useEffect, useMemo, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import {
  DEDUCTION_INPUT_LIMITS,
  PPR_FUNDS_SOURCE,
  PPR_INSURANCE_SOURCE,
  PPR_KINDS,
  PPR_PRODUCTS,
  PPR_RISK_CLASSES,
  PPR_SORTS,
  PPR_TAX_RULES,
  filterProducts,
  isFundsDataStale,
  isInsuranceDataStale,
  pprDeduction,
  riskClassSummary,
  sortProducts,
  validateDeduction,
  type DeductionInput,
  type PprFilters,
  type PprProduct,
  type PprSort,
  type RiskFilter,
} from "@/lib/calculators/pprComparison";
import { createPprFormat } from "@/lib/calculators/pprFormat";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

const k = (key: string) => `tools.pprComparison.${key}`;
/** Products shown at first, and added by each "show more". */
const PAGE_SIZE = 20;

export default function PprComparisonComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <PprComparison />
    </ReactTranslationsProvider>
  );
}

function usePprFormat() {
  const { t, locale } = useTranslations();
  return { t, locale, ...createPprFormat(t, locale) };
}

/** Reports one use per page view, with no filter, figure or product in it. */
function useUsageEvent() {
  const sent = useRef(false);
  return () => {
    if (sent.current) return;
    sent.current = true;
    pushGtmEvent({ event: "tool_used", tool: "ppr_comparison", page_type: getPageType() });
  };
}

const linkClass = "font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80";

function PprComparison() {
  const { t, date } = usePprFormat();
  const reportUse = useUsageEvent();
  const [stale, setStale] = useState({ funds: false, insurance: false });

  // Checked in the browser, after hydration, so a page built long ago still warns.
  useEffect(() => {
    const now = new Date();
    setStale({ funds: isFundsDataStale(now), insurance: isInsuranceDataStale(now) });
  }, []);

  return (
    <>
      <section aria-labelledby="ppr-data" className="rounded-card border border-border bg-paper-2 p-5 sm:p-6">
        <h2 id="ppr-data" className="text-lg font-semibold text-foreground sm:text-xl">
          {t(k("data.title"))}
        </h2>
        <ul className="mt-2 space-y-1 text-sm text-foreground">
          <li>
            {t(k("data.funds"), { date: date(PPR_FUNDS_SOURCE.fetchedOn), year: String(PPR_FUNDS_SOURCE.returnsYear) })}{" "}
            <a href={PPR_FUNDS_SOURCE.url} rel="noopener" target="_blank" className={linkClass}>
              {t(k("data.cmvmLink"))}
            </a>
          </li>
          <li>
            {t(k("data.insurance"), { date: date(PPR_INSURANCE_SOURCE.fetchedOn), year: String(PPR_INSURANCE_SOURCE.returnsYear) })}{" "}
            <a href={PPR_INSURANCE_SOURCE.url} rel="noopener" target="_blank" className={linkClass}>
              {t(k("data.asfLink"))}
            </a>
          </li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">{t(k("data.source"))}</p>
      </section>
      {stale.funds && (
        <div role="status" className="mt-4 rounded-card border border-warning-text/40 bg-background p-4 text-sm text-foreground">
          <p className="font-semibold text-warning-text">{t(k("data.staleTitle"))}</p>
          <p className="mt-1">{t(k("data.staleFunds"), { date: date(PPR_FUNDS_SOURCE.fetchedOn) })}</p>
        </div>
      )}
      {stale.insurance && (
        <div role="status" className="mt-4 rounded-card border border-warning-text/40 bg-background p-4 text-sm text-foreground">
          <p className="font-semibold text-warning-text">{t(k("data.staleTitle"))}</p>
          <p className="mt-1">{t(k("data.staleInsurance"), { year: String(PPR_INSURANCE_SOURCE.returnsYear) })}</p>
        </div>
      )}

      <Comparison onUse={reportUse} />
      <Deduction onUse={reportUse} />
      <Notices />
    </>
  );
}

function Comparison({ onUse }: { onUse: () => void }) {
  const { t, percent } = usePprFormat();
  const [filters, setFilters] = useState<PprFilters>({ kind: "all", riskClass: "all", query: "" });
  const [sort, setSort] = useState<PprSort>("name");
  const [shown, setShown] = useState(PAGE_SIZE);

  const results = useMemo(() => sortProducts(filterProducts(PPR_PRODUCTS, filters), sort), [filters, sort]);
  const summary = typeof filters.riskClass === "number" ? riskClassSummary(results, filters.riskClass) : null;
  const update = (next: Partial<PprFilters>) => {
    onUse();
    setShown(PAGE_SIZE);
    setFilters((current) => ({ ...current, ...next }));
  };
  const comparingReturnsAcrossRisk = sort !== "name" && sort !== "cost" && filters.riskClass === "all";

  return (
    <section aria-labelledby="ppr-compare" className="mt-10">
      <h2 id="ppr-compare" className="text-2xl font-semibold tracking-tight text-foreground">
        {t(k("compare.title"))}
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t(k("compare.intro"))}</p>

      <div className="mt-5 grid gap-5 rounded-card border border-border bg-background p-5 shadow-sm sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
        <div className="space-y-1.5">
          <label htmlFor="ppr-kind" className="block text-sm font-medium text-foreground">
            {t(k("compare.kind"))}
          </label>
          <Select
            id="ppr-kind"
            value={filters.kind}
            onChange={(event) => update({ kind: event.currentTarget.value as PprFilters["kind"] })}
          >
            <option value="all">{t(k("compare.allKinds"))}</option>
            {PPR_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(k(`kinds.${kind}`))}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ppr-risk" className="block text-sm font-medium text-foreground">
            {t(k("compare.risk"))}
          </label>
          <Select
            id="ppr-risk"
            value={String(filters.riskClass)}
            onChange={(event) => {
              const value = event.currentTarget.value;
              update({ riskClass: (value === "all" || value === "none" ? value : Number(value)) as RiskFilter });
            }}
          >
            <option value="all">{t(k("compare.allRisks"))}</option>
            {PPR_RISK_CLASSES.map((risk) => (
              <option key={risk} value={risk}>
                {t(k("labels.riskValue"), { risk: String(risk) })}
              </option>
            ))}
            <option value="none">{t(k("compare.noRisk"))}</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ppr-sort" className="block text-sm font-medium text-foreground">
            {t(k("compare.sort"))}
          </label>
          <Select
            id="ppr-sort"
            value={sort}
            onChange={(event) => {
              onUse();
              setShown(PAGE_SIZE);
              setSort(event.currentTarget.value as PprSort);
            }}
          >
            {PPR_SORTS.map((item) => (
              <option key={item} value={item}>
                {t(k(`sorts.${item}`))}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ppr-search" className="block text-sm font-medium text-foreground">
            {t(k("compare.search"))}
          </label>
          <Input
            id="ppr-search"
            type="search"
            value={filters.query}
            placeholder={t(k("compare.searchPlaceholder"))}
            onChange={(event) => update({ query: event.currentTarget.value })}
          />
        </div>
      </div>

      <div aria-live="polite" className="mt-4 space-y-2 text-sm">
        {comparingReturnsAcrossRisk && (
          <p className="rounded-card border border-warning-text/40 bg-background p-3 text-foreground">{t(k("compare.mixedRisk"))}</p>
        )}
        {summary && summary.count > 0 && summary.minCost !== null && summary.maxCost !== null && summary.medianCost !== null && (
          <p className="text-muted-foreground">
            {t(k("compare.riskSummary"), {
              risk: String(filters.riskClass),
              count: String(summary.count),
              min: percent(summary.minCost),
              max: percent(summary.maxCost),
              median: percent(summary.medianCost),
            })}
          </p>
        )}
        <p className="font-medium text-foreground">
          {results.length === 0 ? t(k("compare.empty")) : t(k("compare.count"), { count: String(results.length) })}
        </p>
      </div>

      {results.length > 0 && (
        // One bordered list with a hairline between products, rather than a card per product.
        <ol className="mt-3 divide-y divide-border rounded-card border border-border bg-background">
          {results.slice(0, shown).map((item) => (
            <ProductRow key={item.id} item={item} />
          ))}
        </ol>
      )}
      {results.length > shown && (
        <button
          type="button"
          onClick={() => setShown((current) => current + PAGE_SIZE)}
          className="mt-4 inline-flex min-h-11 items-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-paper-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t(k("compare.showMore"), { count: String(Math.min(PAGE_SIZE, results.length - shown)), total: String(results.length) })}
        </button>
      )}
    </section>
  );
}

function ProductRow({ item }: { item: PprProduct }) {
  const { t, maybePercent, feeRange, productName, kind, risk, percent, notPublished } = usePprFormat();
  const fund = item.kind === "fund";
  const figures: { label: string; value: string }[] = [
    { label: t(k("labels.risk")), value: risk(item) },
    { label: t(k(fund ? "labels.costFund" : "labels.costAsf")), value: maybePercent(item.yearlyCost) },
    { label: t(k("labels.y1")), value: maybePercent(item.returns.y1) },
    { label: t(k("labels.y3")), value: maybePercent(item.returns.y3) },
    { label: t(k("labels.y5")), value: maybePercent(item.returns.y5) },
    { label: t(k("labels.y10")), value: maybePercent(item.returns.y10) },
  ];
  const guarantee =
    item.capitalGuarantee === null
      ? null
      : [
          t(k("labels.capitalGuarantee"), { value: t(k(`guarantees.${item.capitalGuarantee}`)) }),
          item.returnGuarantee ? t(k("labels.returnGuarantee"), { value: t(k(`guarantees.${item.returnGuarantee}`)) }) : null,
          item.minGuaranteedRate !== null && item.minGuaranteedRate > 0
            ? t(k("labels.minRate"), { pct: percent(item.minGuaranteedRate) })
            : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <li className="p-4 sm:p-5">
      <div className="lg:flex lg:items-start lg:justify-between lg:gap-6">
        <div className="min-w-0 lg:w-80 lg:shrink-0">
          <p className="break-words text-base font-semibold text-foreground">{productName(item)}</p>
          <p className="break-words text-xs text-muted-foreground">{item.manager}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {kind(item)}
            {item.category ? ` · ${t(k(`categories.${item.category}`))}` : ""}
          </p>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2 text-sm sm:grid-cols-6 lg:mt-0 lg:flex-1">
          {figures.map((figure) => (
            <div key={figure.label}>
              <dt className="text-xs text-muted-foreground">{figure.label}</dt>
              {/* "Not published" in the body font, so it reads as a note rather than a figure. */}
              <dd className={figure.value === notPublished ? "text-xs leading-6 text-muted-foreground" : "font-mono text-foreground"}>
                {figure.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="mt-3 space-y-1 border-t border-border-2 pt-3 text-xs text-muted-foreground">
        {fund ? (
          <p>{t(k("labels.fundFees"))}</p>
        ) : (
          <p>
            {t(k("labels.fees"), {
              subscription: feeRange(item.subscriptionFee),
              redemption: feeRange(item.redemptionFee),
              transfer: feeRange(item.transferFee),
            })}
          </p>
        )}
        {guarantee && <p>{guarantee}</p>}
        <p>
          {item.documentUrl ? (
            <a href={item.documentUrl} rel="noopener" target="_blank" className={linkClass}>
              {t(k("labels.ifi"))}
            </a>
          ) : (
            <a href={PPR_INSURANCE_SOURCE.url} rel="noopener" target="_blank" className={linkClass}>
              {t(k("labels.asfSource"))}
            </a>
          )}
        </p>
      </div>
    </li>
  );
}

function Deduction({ onUse }: { onUse: () => void }) {
  const { t, eur, rate } = usePprFormat();
  const [input, setInput] = useState<DeductionInput>({ age: 40, contribution: 1000, retired: false });
  const errors = validateDeduction(input);
  const result = errors.length === 0 ? pprDeduction(input) : null;
  const update = <K extends keyof DeductionInput>(field: K, value: DeductionInput[K]) => {
    onUse();
    setInput((current) => ({ ...current, [field]: value }));
  };

  return (
    <section aria-labelledby="ppr-deduction" className="mt-12">
      <h2 id="ppr-deduction" className="text-2xl font-semibold tracking-tight text-foreground">
        {t(k("deduction.title"))}
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        {t(k("deduction.intro"), { rate: rate(PPR_TAX_RULES.deductionRate) })}
      </p>
      <div className="mt-5">
      <CalculatorLayout>
      <div className="grid gap-5 rounded-card border border-border bg-background p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-1">
        <CalculatorInput
          id="ppr-age"
          label={t(k("deduction.age"))}
          value={input.age}
          onChange={(value) => update("age", value)}
          min={0}
          max={DEDUCTION_INPUT_LIMITS.maxAge}
          step={1}
          helpText={t(k("deduction.ageHelp"))}
          error={errors.includes("age") ? t(k("deduction.errors.age"), { max: String(DEDUCTION_INPUT_LIMITS.maxAge) }) : undefined}
        />
        <CalculatorInput
          id="ppr-contribution"
          label={t(k("deduction.contribution"))}
          value={input.contribution}
          onChange={(value) => update("contribution", value)}
          min={0}
          max={DEDUCTION_INPUT_LIMITS.maxContribution}
          step={100}
          prefix="€"
          error={
            errors.includes("contribution")
              ? t(k("deduction.errors.contribution"), { max: eur(DEDUCTION_INPUT_LIMITS.maxContribution) })
              : undefined
          }
        />
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-foreground sm:col-span-2 lg:col-span-1">
          <input
            type="checkbox"
            checked={input.retired}
            onChange={(event) => update("retired", event.currentTarget.checked)}
            className="h-5 w-5 shrink-0 rounded border-input accent-primary"
          />
          {t(k("deduction.retired"))}
        </label>
      </div>
      <div aria-live="polite" className="rounded-card border border-border bg-background p-5 text-sm text-foreground sm:p-6">
        {result === null ? (
          <p className="text-muted-foreground">{t(k("deduction.invalid"))}</p>
        ) : input.retired ? (
          <p>{t(k("deduction.retiredResult"))}</p>
        ) : (
          <>
            <p className="text-lg font-semibold sm:text-xl">{t(k("deduction.result"), { amount: eur(result.deduction) })}</p>
            <p className="mt-3 border-t border-border pt-3">
              {t(k("deduction.limit"), { limit: eur(result.limit), full: eur(result.fullDeductionAt), age: String(input.age) })}
            </p>
            {result.capped && <p className="mt-1">{t(k("deduction.capped"), { full: eur(result.fullDeductionAt) })}</p>}
            <p className="mt-2 text-xs text-muted-foreground">
              {t(k("deduction.cap"), { min: eur(PPR_TAX_RULES.overallCap.min), max: eur(PPR_TAX_RULES.overallCap.max) })}
            </p>
          </>
        )}
      </div>
      </CalculatorLayout>
      </div>
    </section>
  );
}

function Notices() {
  const { t } = useTranslations();
  return (
    <section aria-labelledby="ppr-notices" className="mt-12 grid gap-4 md:grid-cols-3">
      <h2 id="ppr-notices" className="sr-only">
        {t(k("notices.title"))}
      </h2>
      {(["educational", "neutral", "tax"] as const).map((item) => (
        <div key={item} className="rounded-card border border-border bg-background p-5 shadow-sm">
          <h3 className="text-base font-semibold text-foreground">{t(k(`notices.${item}Title`))}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{t(k(`notices.${item}`))}</p>
        </div>
      ))}
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";
import {
  GOLD_LIMITS,
  GOLD_PRICES,
  GOLD_PRICE_SOURCE,
  GOLD_PURITIES,
  computeGoldValue,
  goldPriceSummary,
  goldValueExample,
  type GoldPurity,
  type GoldValueField,
  type GoldValueInput,
  type GoldValueResult,
} from "@/lib/calculators/goldValue";
import { snapshotAgeDays } from "@/lib/calculators/snapshotAge";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { toLocalizedPath } from "@/lib/routes";

const k = (key: string) => `tools.goldPrice.${key}`;
const SUMMARY = goldPriceSummary();
/** NBP publishes on Polish business days, so a long weekend leaves the price a few days old. */
const STALE_AFTER_DAYS = 5;

export default function GoldPriceComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <GoldPrice />
    </ReactTranslationsProvider>
  );
}

function GoldPrice() {
  const { t, locale } = useTranslations();
  const [input, setInput] = useState<GoldValueInput>(() => goldValueExample());
  const [edited, setEdited] = useState(false);
  const usageSent = useRef(false);

  const calculation = useMemo(() => computeGoldValue(input), [input]);
  const result = calculation.ok ? calculation.result : null;
  const errors = calculation.ok ? {} : calculation.errors;

  useEffect(() => {
    if (!edited || !result || usageSent.current) return;
    usageSent.current = true;
    // Metadata only: never the weight, the purity, the price, the offer or the value.
    pushGtmEvent({ event: "tool_used", tool: "gold_price", page_type: getPageType() });
  }, [edited, result]);

  const update = <K extends keyof GoldValueInput>(field: K, value: GoldValueInput[K]) => {
    setEdited(true);
    setInput((current) => ({ ...current, [field]: value }));
  };
  const euro = (value: number, decimals = 2) => formatMoney(locale, value, { decimals });
  const maxLabel = (field: GoldValueField) =>
    field === "grams" ? `${formatNumber(locale, GOLD_LIMITS.grams)} g` : euro(GOLD_LIMITS[field], 0);
  const errorFor = (field: GoldValueField) => {
    const error = (errors as Partial<Record<GoldValueField, string>>)[field];
    return error ? t(k(`errors.${error}`), { max: maxLabel(field) }) : undefined;
  };
  const latest = SUMMARY.eurPerGram;
  const priceDiffers = Number.isFinite(input.price) ? Math.abs(input.price - latest) > 0.005 : true;

  return (
    <>
      <LatestPrice />
      <CalculatorLayout>
        <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
          <CalculatorInput
            id="gold-grams"
            label={t(k("fields.grams"))}
            value={input.grams}
            onChange={(value) => update("grams", value)}
            min={0}
            max={GOLD_LIMITS.grams}
            step={0.1}
            suffix="g"
            helpText={t(k("help.grams"))}
            error={errorFor("grams")}
          />
          <div className="space-y-1.5">
            <label htmlFor="gold-purity" className="block text-sm font-medium text-foreground">
              {t(k("fields.purity"))}
            </label>
            <select
              id="gold-purity"
              value={input.purity}
              onChange={(event) => update("purity", event.currentTarget.value as GoldPurity)}
              aria-describedby="gold-purity-help"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {GOLD_PURITIES.map((purity) => (
                <option key={purity.id} value={purity.id}>
                  {t(k(`purities.${purity.id}`), {
                    karat: formatNumber(locale, purity.karat, purity.karat % 1 ? 1 : 0),
                    fineness: purity.fineness,
                  })}
                </option>
              ))}
            </select>
            <p id="gold-purity-help" className="text-sm text-muted-foreground">
              {t(k("help.purity"))}
            </p>
          </div>
          <div className="space-y-2">
            <CalculatorInput
              id="gold-price"
              label={t(k("fields.price"))}
              value={input.price}
              onChange={(value) => update("price", value)}
              min={0}
              max={GOLD_LIMITS.price}
              step={0.01}
              suffix="€/g"
              helpText={t(k("help.price"), { price: euro(latest), date: GOLD_PRICE_SOURCE.asOf })}
              error={errorFor("price")}
            />
            {priceDiffers && (
              <button
                type="button"
                onClick={() => update("price", latest)}
                className="text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t(k("fields.resetPrice"), { price: euro(latest) })}
              </button>
            )}
          </div>
          <CalculatorInput
            id="gold-offer"
            label={t(k("fields.offer"))}
            value={input.offer}
            onChange={(value) => update("offer", value)}
            min={0}
            max={GOLD_LIMITS.offer}
            step={1}
            suffix="€"
            helpText={t(k("help.offer"))}
            error={errorFor("offer")}
          />
        </div>

        <div className="min-w-0 space-y-5 rounded-card border border-border bg-background p-6 shadow-sm lg:sticky lg:top-24">
          {result ? (
            <Value result={result} input={input} euro={euro} />
          ) : (
            <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>
          )}
          <p className="text-xs text-muted-foreground">{t(k("notes.assumptions"))}</p>
        </div>
      </CalculatorLayout>

      <Recent />
    </>
  );
}

function LatestPrice() {
  const { t, locale } = useTranslations();
  const [ageDays, setAgeDays] = useState(0);
  // Measured on the visitor's clock after hydration, so the prerendered page never shows it.
  useEffect(() => setAgeDays(snapshotAgeDays(GOLD_PRICE_SOURCE.asOf)), []);
  const change = (value: number) => formatPercent(locale, value, { decimals: 1, sign: "always" });

  return (
    <section className="mb-10 space-y-4" aria-labelledby="gold-latest-title">
      <h2 id="gold-latest-title" className="text-2xl font-semibold tracking-tight text-foreground">
        {t(k("latest.title"))}
      </h2>
      <p className="font-medium text-foreground">{t(k("latest.asOf"), { date: SUMMARY.date })}</p>
      {ageDays > STALE_AFTER_DAYS && (
        <p role="status" className="rounded-lg border border-warning-text/30 px-4 py-3 text-sm text-foreground">
          {t(k("latest.stale"), { days: formatNumber(locale, ageDays), date: SUMMARY.date })}
        </p>
      )}
      <ul className="grid gap-4 sm:grid-cols-3">
        <li className="rounded-card border border-border bg-background p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">{t(k("latest.perGram"))}</p>
          <p className="font-mono text-2xl font-bold text-foreground">{formatMoney(locale, SUMMARY.eurPerGram, { decimals: 2 })}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(k("latest.dayChange"), { percent: change(SUMMARY.dayChangePercent), date: SUMMARY.previousDate })}
          </p>
        </li>
        <li className="rounded-card border border-border bg-background p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">{t(k("latest.perOunce"))}</p>
          <p className="font-mono text-2xl font-bold text-foreground">{formatMoney(locale, SUMMARY.eurPerOunce, { decimals: 0 })}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(k("latest.periodChange"), { percent: change(SUMMARY.periodChangePercent), date: SUMMARY.firstDate })}
          </p>
        </li>
        <li className="rounded-card border border-border bg-background p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">{t(k("latest.portuguese"))}</p>
          <p className="font-mono text-2xl font-bold text-foreground">
            {formatMoney(locale, (SUMMARY.eurPerGram * 800) / 1000, { decimals: 2 })}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{t(k("latest.portugueseNote"))}</p>
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">{t(k("latest.note"))}</p>
    </section>
  );
}

type Euro = (value: number, decimals?: number) => string;

function Value({ result, input, euro }: { result: GoldValueResult; input: GoldValueInput; euro: Euro }) {
  const { t, locale } = useTranslations();
  const grams = (value: number) => `${formatNumber(locale, value, value % 1 ? 2 : 0)} g`;

  return (
    <>
      <CalculatorResult
        items={[
          { label: t(k("result.value")), value: euro(result.value), highlight: true },
          { label: t(k("result.pureGrams")), value: grams(result.pureGrams) },
          ...(input.grams > 0 ? [{ label: t(k("result.perGram")), value: `${euro(result.value / input.grams)}/g` }] : []),
        ]}
      />
      {result.value === 0 && <p className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">{t(k("result.nothing"))}</p>}
      {result.offerGap !== null && (
        <p className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">
          {result.offerShare === null
            ? t(k("result.offerNoValue"))
            : result.offerGap >= 0
              ? t(k("result.offerBelow"), {
                  share: formatPercent(locale, result.offerShare, { decimals: 0 }),
                  gap: euro(result.offerGap),
                })
              : t(k("result.offerAbove"), {
                  share: formatPercent(locale, result.offerShare, { decimals: 0 }),
                  gap: euro(-result.offerGap),
                })}
        </p>
      )}
      <p className="text-sm text-foreground">{t(k("result.buyers"))}</p>
      <div className="space-y-2 rounded-lg bg-paper-2 px-4 py-3">
        <p className="text-sm text-foreground">{t(k("result.netWorth"), { amount: euro(result.value) })}</p>
        <a
          href={toLocalizedPath("featureNetWorth", locale)}
          onClick={() => pushGtmEvent({ event: "cta_click", cta_position: "tool_result", page_type: getPageType() })}
          className="text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80"
        >
          {t(k("nextStepCta"))}
        </a>
      </div>
    </>
  );
}

function Recent() {
  const { t, locale } = useTranslations();
  const recent = GOLD_PRICES.slice(-10).reverse();
  const number = (value: number, decimals: number) => formatNumber(locale, value, decimals);

  return (
    <section className="mt-10 space-y-4" aria-labelledby="gold-recent-title">
      <h2 id="gold-recent-title" className="text-2xl font-semibold tracking-tight text-foreground">
        {t(k("recent.title"))}
      </h2>
      <p className="max-w-3xl leading-7 text-ink-2">{t(k("recent.intro"))}</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[30rem] text-sm">
          <caption className="sr-only">{t(k("recent.caption"))}</caption>
          <thead className="bg-paper-2 text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">{t(k("recent.date"))}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("recent.eurPerGram"))}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("recent.plnPerGram"))}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("recent.rate"))}</th>
            </tr>
          </thead>
          <tbody>
            {recent.map(([date, pln, rate, eur]) => (
              <tr key={date} className="border-t border-border-2">
                <th scope="row" className="px-3 py-2 text-left font-mono font-normal text-foreground">{date}</th>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">{formatMoney(locale, eur, { decimals: 2 })}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">{number(pln, 2)} zł</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">{number(rate, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(k("recent.asOf"), { date: GOLD_PRICE_SOURCE.asOf, fetched: GOLD_PRICE_SOURCE.fetchedOn })}
      </p>
    </section>
  );
}

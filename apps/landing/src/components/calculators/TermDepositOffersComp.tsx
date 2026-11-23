import { useEffect, useMemo, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import {
  DEFAULT_OFFER_FILTERS,
  TERM_DEPOSIT_OFFERS,
  TERM_DEPOSIT_OFFERS_AS_OF,
  filterOffers,
  offerReturn,
  offerTerms,
  sortOffers,
  type OfferFilters,
  type TermDepositOffer,
} from "@/lib/calculators/termDepositOffers";
import { DEPOSIT_TAX_RATE, bucketForTerm, latestRates, monthToDate } from "@/lib/calculators/depositRates";
import { SAVINGS_CERTIFICATES_RULES, computeSavingsCertificates } from "@/lib/calculators/savingsCertificates";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatMonthYear, formatPercent } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { toLocalizedPath } from "@/lib/routes";
import { Select } from "@/components/ui/select";
import BrandLogo from "@/components/shared/BrandLogo";
import TrademarkDisclaimer from "@/components/shared/TrademarkDisclaimer";

const k = (key: string) => `tools.termDepositOffers.${key}`;
const MAX_AMOUNT = 100_000_000;

export default function TermDepositOffersComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <TermDepositOffers />
    </ReactTranslationsProvider>
  );
}

function TermDepositOffers() {
  const { t, locale } = useTranslations();
  const [filters, setFilters] = useState<OfferFilters>({ ...DEFAULT_OFFER_FILTERS });
  const [edited, setEdited] = useState(false);
  const usageSent = useRef(false);

  useEffect(() => {
    if (!edited || usageSent.current) return;
    usageSent.current = true;
    // Metadata only: never the amount, the filters or the offers shown.
    pushGtmEvent({ event: "tool_used", tool: "term_deposit_offers", page_type: getPageType() });
  }, [edited]);

  const update = <K extends keyof OfferFilters>(field: K, value: OfferFilters[K]) => {
    setEdited(true);
    setFilters((current) => ({ ...current, [field]: value }));
  };

  const amountValid = Number.isFinite(filters.amount) && filters.amount > 0 && filters.amount <= MAX_AMOUNT;
  const effective = useMemo(() => ({ ...filters, amount: amountValid ? filters.amount : Number.NaN }), [filters, amountValid]);
  const visible = useMemo(() => sortOffers(filterOffers(effective)), [effective]);
  const terms = useMemo(() => offerTerms(), []);
  const eur = (value: number, decimals = 2) => formatMoney(locale, value, { currency: "EUR", decimals });
  const percent = (value: number) => formatPercent(locale, value, { decimals: 2 });
  const amountError = Number.isNaN(filters.amount)
    ? t(k("errors.amountRequired"))
    : filters.amount <= 0
      ? t(k("errors.amountPositive"))
      : filters.amount > MAX_AMOUNT
        ? t(k("errors.amountTooLarge"), { max: eur(MAX_AMOUNT, 0) })
        : undefined;

  const checkbox = (id: string, field: "existingClients" | "noNewMoney" | "earlyWithdrawal", label: string) => (
    <label htmlFor={id} className="flex items-start gap-2 text-sm text-foreground">
      <input
        id={id}
        type="checkbox"
        checked={filters[field]}
        onChange={(event) => update(field, event.currentTarget.checked)}
        className="mt-0.5 h-4 w-4 rounded border-input"
      />
      <span>{label}</span>
    </label>
  );

  return (
    <section aria-labelledby="offers-title" className="min-w-0 space-y-6">
      <div>
        <h2 id="offers-title" className="text-2xl font-semibold tracking-tight text-foreground">
          {t(k("offers.title"))}
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t(k("offers.intro"))}</p>
      </div>

      <div className="grid gap-5 rounded-card border border-border bg-background p-6 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        <CalculatorInput
          id="offers-amount"
          label={t(k("filters.amount"))}
          value={filters.amount}
          onChange={(value) => update("amount", value)}
          min={0}
          max={MAX_AMOUNT}
          step={500}
          prefix="€"
          helpText={t(k("filters.amountHelp"))}
          error={amountError}
        />
        <div className="space-y-1.5">
          <label htmlFor="offers-term" className="block text-sm font-medium text-foreground">
            {t(k("filters.term"))}
          </label>
          <Select
            id="offers-term"
            value={filters.termMonths === null ? "" : String(filters.termMonths)}
            onChange={(event) => update("termMonths", event.currentTarget.value === "" ? null : Number(event.currentTarget.value))}
          >
            <option value="">{t(k("filters.termAll"))}</option>
            {terms.map((term) => (
              <option key={term} value={term}>
                {t(k("filters.termOption"), { months: String(term) })}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="offers-irs" className="block text-sm font-medium text-foreground">
            {t(k("filters.irs"))}
          </label>
          <Select
            id="offers-irs"
            value={filters.irs}
            onChange={(event) => update("irs", event.currentTarget.value as OfferFilters["irs"])}
          >
            <option value="all">{t(k("filters.irsAll"))}</option>
            <option value="withheld">{t(k("filters.irsWithheld"))}</option>
            <option value="notWithheld">{t(k("filters.irsNotWithheld"))}</option>
          </Select>
        </div>
        <fieldset className="space-y-3 sm:col-span-2 lg:col-span-3">
          <legend className="sr-only">{t(k("filters.conditions"))}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {checkbox("offers-existing", "existingClients", t(k("filters.existingClients")))}
            {checkbox("offers-nomoney", "noNewMoney", t(k("filters.noNewMoney")))}
            {checkbox("offers-early", "earlyWithdrawal", t(k("filters.earlyWithdrawal")))}
          </div>
        </fieldset>
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t(k("count"), { count: String(visible.length), total: String(TERM_DEPOSIT_OFFERS.length) })}
      </p>

      {visible.length === 0 ? (
        <p className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">{t(k("none"))}</p>
      ) : (
        <>
          <OfferCards offers={visible} amount={amountValid ? filters.amount : null} eur={eur} percent={percent} />
          <OfferTable offers={visible} amount={amountValid ? filters.amount : null} eur={eur} percent={percent} />
        </>
      )}

      <Comparison visible={visible} amount={amountValid ? filters.amount : null} termMonths={filters.termMonths} eur={eur} percent={percent} />
      <Disclaimers />
      <TrademarkDisclaimer textKey="lp.trademarks.tmGeneric" />
    </section>
  );
}

type RowProps = {
  offers: readonly TermDepositOffer[];
  amount: number | null;
  eur: (value: number, decimals?: number) => string;
  percent: (value: number) => string;
};

function useOfferText() {
  const { t, locale } = useTranslations();
  const limit = (value: number | null) => (value === null ? t(k("notStated")) : formatMoney(locale, value, { currency: "EUR", decimals: 0 }));
  const flags = (offer: TermDepositOffer) => {
    const list: string[] = [];
    if (offer.newClients) list.push(t(k("badges.newClients")));
    if (offer.newMoney) list.push(t(k("badges.newMoney")));
    list.push(t(k(`badges.early.${offer.earlyWithdrawal}`)));
    list.push(t(k(offer.irsNotWithheld ? "badges.irsNotWithheld" : "badges.irsWithheld")));
    return list;
  };
  return { t, limit, flags };
}

function returnText(offer: TermDepositOffer, amount: number | null, eur: RowProps["eur"], percent: RowProps["percent"]) {
  const result = amount === null ? null : offerReturn(offer, amount);
  return { net: result ? eur(result.netInterest) : "—", yearly: result ? percent(result.netAnnualYield) : "—" };
}

function Notes({ offer }: { offer: TermDepositOffer }) {
  const { t } = useTranslations();
  if (!offer.notes) return null;
  return (
    <div className="text-xs text-muted-foreground">
      <p className="font-medium">{t(k("notesLabel"))}</p>
      {/* Verbatim Portuguese text from the bank's offer: not translated. */}
      <p lang="pt-PT" className="whitespace-pre-line">{offer.notes}</p>
    </div>
  );
}

/** "Not stated" reads as a note, in the body face, rather than as a figure. */
const notStatedClass = "text-xs text-muted-foreground";

function OfferCards({ offers, amount, eur, percent }: RowProps) {
  const { t, limit, flags } = useOfferText();
  return (
    <ul className="divide-y divide-border rounded-card border border-border bg-background md:hidden" aria-label={t(k("offers.title"))}>
      {offers.map((offer, index) => {
        const value = returnText(offer, amount, eur, percent);
        return (
          <li key={index} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <BrandLogo name={offer.bank} />
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">{offer.bank}</p>
                  <p className="text-sm text-muted-foreground">{offer.product}</p>
                </div>
              </div>
              <p className="shrink-0 font-mono text-xl font-semibold text-foreground">{percent(offer.tanb)}</p>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">{t(k("columns.term"))}</dt>
                <dd className="font-mono text-foreground">{t(k("filters.termOption"), { months: String(offer.termMonths) })}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t(k("columns.netInterest"))}</dt>
                <dd className="font-mono font-semibold text-foreground">{value.net}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t(k("columns.minimum"))}</dt>
                <dd className={offer.minimum === null ? notStatedClass : "font-mono text-foreground"}>{limit(offer.minimum)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t(k("columns.maximum"))}</dt>
                <dd className={offer.maximum === null ? notStatedClass : "font-mono text-foreground"}>{limit(offer.maximum)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground">{t(k("columns.netYield"))}</dt>
                <dd className="font-mono text-foreground">{value.yearly}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-foreground">{flags(offer).join(" · ")}</p>
            <div className="mt-2">
              <Notes offer={offer} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function OfferTable({ offers, amount, eur, percent }: RowProps) {
  const { t, limit, flags } = useOfferText();
  const head = "px-3 py-2 font-medium";
  return (
    <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
      <table className="w-full text-sm">
        <caption className="sr-only">{t(k("offers.caption"))}</caption>
        <thead className="bg-paper-2 text-muted-foreground">
          <tr>
            <th scope="col" className={`${head} text-right`}>{t(k("columns.tanb"))}</th>
            <th scope="col" className={`${head} text-right`}>{t(k("columns.term"))}</th>
            <th scope="col" className={`${head} text-left`}>{t(k("columns.bank"))}</th>
            <th scope="col" className={`${head} text-right`}>{t(k("columns.minimum"))}</th>
            <th scope="col" className={`${head} text-right`}>{t(k("columns.maximum"))}</th>
            <th scope="col" className={`${head} text-right`}>{t(k("columns.netInterest"))}</th>
            <th scope="col" className={`${head} text-right`}>{t(k("columns.netYield"))}</th>
            <th scope="col" className={`${head} text-left`}>{t(k("columns.conditions"))}</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((offer, index) => {
            const value = returnText(offer, amount, eur, percent);
            return (
              <tr key={index} className="border-t border-border-2 align-top">
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold text-foreground">{percent(offer.tanb)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">{offer.termMonths}</td>
                <th scope="row" className="px-3 py-2 text-left font-normal text-foreground">
                  <span className="flex items-start gap-2">
                    <BrandLogo name={offer.bank} />
                    <span className="min-w-0">
                      <span className="font-medium">{offer.bank}</span>
                      <span className="block text-xs text-muted-foreground">{offer.product}</span>
                    </span>
                  </span>
                </th>
                <td className={`whitespace-nowrap px-3 py-2 text-right ${offer.minimum === null ? notStatedClass : "font-mono text-foreground"}`}>{limit(offer.minimum)}</td>
                <td className={`whitespace-nowrap px-3 py-2 text-right ${offer.maximum === null ? notStatedClass : "font-mono text-foreground"}`}>{limit(offer.maximum)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold text-foreground">{value.net}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">{value.yearly}</td>
                <td className="min-w-[14rem] max-w-xs px-3 py-2 text-xs text-foreground">
                  <p>{flags(offer).join(" · ")}</p>
                  <div className="mt-1">
                    <Notes offer={offer} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Comparison({
  visible,
  amount,
  termMonths,
  eur,
  percent,
}: {
  visible: readonly TermDepositOffer[];
  amount: number | null;
  termMonths: number | null;
  eur: RowProps["eur"];
  percent: RowProps["percent"];
}) {
  const { t, locale } = useTranslations();
  const latest = useMemo(() => latestRates(), []);
  const bucket = termMonths === null ? "all" : bucketForTerm(termMonths);
  const average = latest.pt[bucket] ?? latest.pt.all;
  const month = formatMonthYear(locale, monthToDate(latest.month));
  const best = visible[0];
  const certificates = useMemo(() => {
    if (amount === null) return null;
    const outcome = computeSavingsCertificates({
      amount,
      years: 1,
      baseRate: SAVINGS_CERTIFICATES_RULES.referenceBaseRate.rate,
    });
    return outcome.ok ? outcome.result : null;
  }, [amount]);
  const gap = best && average !== null ? best.tanb - average : null;

  return (
    <section aria-labelledby="offers-compare-title" className="space-y-3 rounded-card border border-border bg-background p-6 shadow-sm">
      <h3 id="offers-compare-title" className="text-lg font-semibold text-foreground">{t(k("compare.title"))}</h3>
      {average !== null && (
        <p className="text-sm text-foreground">
          {t(k(termMonths === null || latest.pt[bucket] !== null ? "compare.average" : "compare.averageFallback"), {
            bucket: t(`tools.depositRateIndex.buckets.${latest.pt[bucket] !== null ? bucket : "all"}`),
            rate: percent(average),
            month,
          })}{" "}
          {gap !== null &&
            t(k(gap >= 0 ? "compare.above" : "compare.below"), { bank: best.bank, tanb: percent(best.tanb), gap: formatPercent(locale, Math.abs(gap), { decimals: 2 }) })}
        </p>
      )}
      <p className="text-sm">
        <a href={toLocalizedPath("toolDepositRateIndex", locale)} className="font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80">
          {t(k("compare.benchmarkLink"))}
        </a>
      </p>
      {certificates && (
        <p className="text-sm text-foreground">
          {t(k("compare.certificates"), {
            net: eur(certificates.netInterest),
            yield: percent(certificates.netAnnualYield),
            rate: percent(SAVINGS_CERTIFICATES_RULES.referenceBaseRate.rate),
            month: formatMonthYear(locale, monthToDate(SAVINGS_CERTIFICATES_RULES.referenceBaseRate.month)),
          })}
        </p>
      )}
      <p className="text-sm">
        <a href={toLocalizedPath("toolSavingsCertificates", locale)} className="font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80">
          {t(k("compare.certificatesLink"))}
        </a>
      </p>
    </section>
  );
}

function Disclaimers() {
  const { t } = useTranslations();
  return (
    <div className="space-y-2 rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">
      <p className="font-semibold">{t(k("disclaimers.asOf"), { date: TERM_DEPOSIT_OFFERS_AS_OF })}</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>{t(k("disclaimers.change"))}</li>
        <li>{t(k("disclaimers.confirm"))}</li>
        <li>
          {t(k("disclaimers.fgd"))}{" "}
          <a href="https://www.fgd.pt/en" rel="noopener" target="_blank" className="font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80">
            fgd.pt
          </a>
        </li>
        <li>{t(k("disclaimers.foreign"))}</li>
        <li>{t(k("disclaimers.assumptions"), { tax: String(DEPOSIT_TAX_RATE) })}</li>
        <li>{t(k("disclaimers.educational"))}</li>
        <li>{t(k("disclaimers.noAffiliate"))}</li>
      </ul>
      <p className="text-xs text-muted-foreground">{t(k("sourceNote"), { date: TERM_DEPOSIT_OFFERS_AS_OF })}</p>
    </div>
  );
}

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import {
  BROKER_FEES,
  BROKER_FEES_ASSUMPTIONS,
  BROKER_FEES_LIMITS,
  BROKER_FEES_REVIEWED,
  PROFILE_IDS,
  SCENARIO_PROFILES,
  compareBrokers,
  isBrokerFeesStale,
  validateScenario,
  type Broker,
  type BrokerCost,
  type Market,
  type ProfileId,
  type Scenario,
} from "@/lib/calculators/brokerFees";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { createFeeFormat, formatCheckedDate } from "@/lib/calculators/brokerFeesFormat";
import { formatMoney } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { Select } from "@/components/ui/select";

const k = (key: string) => `tools.brokerFees.${key}`;
const MARKETS: readonly Market[] = ["etfEu", "usStock"];

export default function BrokerFeesComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <BrokerFees />
    </ReactTranslationsProvider>
  );
}

function useFeeFormat() {
  const { t, locale } = useTranslations();
  return { t, locale, ...createFeeFormat(t, locale) };
}

function BrokerFees() {
  const { t, locale, number } = useFeeFormat();
  const [profile, setProfile] = useState<ProfileId | "custom">("monthlyEtf");
  const [scenario, setScenario] = useState<Scenario>({ ...SCENARIO_PROFILES.monthlyEtf });
  const [touched, setTouched] = useState(false);
  const [stale, setStale] = useState(false);
  const usageSent = useRef(false);

  // Checked in the browser, after hydration, so a page built long ago still warns.
  useEffect(() => {
    setStale(isBrokerFeesStale(new Date()));
  }, []);

  useEffect(() => {
    if (!touched || usageSent.current) return;
    usageSent.current = true;
    // Metadata only: never the profile, the amounts or any broker.
    pushGtmEvent({ event: "tool_used", tool: "broker_fees", page_type: getPageType() });
  }, [touched]);

  const errors = validateScenario(scenario);
  const costs = useMemo(() => (errors.length > 0 ? [] : compareBrokers(scenario)), [scenario, errors.length]);

  const pickProfile = (id: ProfileId) => {
    setTouched(true);
    setProfile(id);
    setScenario({ ...SCENARIO_PROFILES[id] });
  };
  const update = <K extends keyof Scenario>(field: K, value: Scenario[K]) => {
    setTouched(true);
    setProfile("custom");
    setScenario((current) => ({ ...current, [field]: value }));
  };

  const eur = (value: number) => formatMoney(locale, value, { currency: "EUR", decimals: 0 });
  const reviewed = formatCheckedDate(locale, BROKER_FEES_REVIEWED);

  return (
    <>
      <section aria-labelledby="broker-fees-reviewed" className="rounded-card border border-border bg-paper-2 p-5 sm:p-6">
        <p id="broker-fees-reviewed" className="text-lg font-semibold text-foreground sm:text-xl">
          {t(k("review.checked"), { date: reviewed })}
        </p>
        <p className="mt-2 text-sm text-foreground">{t(k("review.confirm"))}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t(k("review.source"))}</p>
      </section>
      {stale && (
        <div role="status" className="mt-4 rounded-card border border-warning-text/40 bg-background p-4 text-sm text-foreground">
          <p className="font-semibold text-warning-text">{t(k("review.staleTitle"))}</p>
          <p className="mt-1">{t(k("review.stale"), { date: reviewed })}</p>
        </div>
      )}

      <h2 className="mt-10 text-2xl font-semibold tracking-tight text-foreground">{t(k("calculator.title"))}</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t(k("calculator.intro"))}</p>

      <div className="mt-6">
        <CalculatorLayout>
          <div className="space-y-5 rounded-card border border-border bg-background p-5 sm:p-6 lg:sticky lg:top-24">
            <fieldset>
              <legend className="text-sm font-medium text-foreground">{t(k("calculator.profile"))}</legend>
              <div className="mt-2 grid gap-2">
                {PROFILE_IDS.map((id) => (
                  <label
                    key={id}
                    className={`flex cursor-pointer gap-3 rounded-md border p-3 text-sm ${
                      profile === id ? "border-primary/60 bg-paper-2" : "border-input bg-background hover:bg-accent"
                    }`}
                  >
                    <input
                      type="radio"
                      name="broker-fees-profile"
                      value={id}
                      checked={profile === id}
                      onChange={() => pickProfile(id)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    />
                    <span>
                      <span className="block font-semibold text-foreground">{t(k(`profiles.${id}.label`))}</span>
                      <span className="mt-1 block text-muted-foreground">{t(k(`profiles.${id}.description`))}</span>
                    </span>
                  </label>
                ))}
              </div>
              {profile === "custom" && <p className="mt-2 text-xs text-muted-foreground">{t(k("profiles.custom"))}</p>}
            </fieldset>

            <div className="grid gap-5 border-t border-border pt-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="broker-fees-market" className="block text-sm font-medium text-foreground">
                  {t(k("fields.market"))}
                </label>
                <Select
                  id="broker-fees-market"
                  className="h-11"
                  value={scenario.market}
                  onChange={(event) => update("market", event.currentTarget.value as Market)}
                >
                  {MARKETS.map((market) => (
                    <option key={market} value={market}>
                      {t(k(`markets.${market}`))}
                    </option>
                  ))}
                </Select>
              </div>
              <CalculatorInput
                id="broker-fees-trades"
                label={t(k("fields.trades"))}
                value={scenario.trades}
                onChange={(value) => update("trades", value)}
                min={0}
                max={BROKER_FEES_LIMITS.maxTrades}
                step={1}
                helpText={t(k("help.trades"))}
                error={errors.includes("trades") ? t(k("errors.trades"), { max: String(BROKER_FEES_LIMITS.maxTrades) }) : undefined}
              />
              <CalculatorInput
                id="broker-fees-amount"
                label={t(k("fields.tradeAmount"))}
                value={scenario.tradeAmount}
                onChange={(value) => update("tradeAmount", value)}
                min={0}
                max={BROKER_FEES_LIMITS.maxTradeAmount}
                step={100}
                prefix="€"
                error={
                  errors.includes("tradeAmount")
                    ? t(k("errors.amount"), { max: eur(BROKER_FEES_LIMITS.maxTradeAmount) })
                    : undefined
                }
              />
              <CalculatorInput
                id="broker-fees-portfolio"
                label={t(k("fields.portfolio"))}
                value={scenario.portfolio}
                onChange={(value) => update("portfolio", value)}
                min={0}
                max={BROKER_FEES_LIMITS.maxPortfolio}
                step={1000}
                prefix="€"
                helpText={t(k("help.portfolio"))}
                error={
                  errors.includes("portfolio") ? t(k("errors.amount"), { max: eur(BROKER_FEES_LIMITS.maxPortfolio) }) : undefined
                }
              />
              {scenario.market === "etfEu" && (
                <label className="col-span-full flex min-h-11 items-center gap-2 text-sm font-medium text-foreground">
                  <input
                    type="checkbox"
                    checked={scenario.useSavingsPlan}
                    onChange={(event) => update("useSavingsPlan", event.currentTarget.checked)}
                    className="h-5 w-5 shrink-0 rounded border-input accent-primary"
                  />
                  {t(k("fields.savingsPlan"))}
                </label>
              )}
            </div>
            <p className="border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
              {t(k("calculator.assumptions"), {
                rate: number(BROKER_FEES_ASSUMPTIONS.eurUsd),
                rateDate: formatCheckedDate(locale, BROKER_FEES_ASSUMPTIONS.eurUsdDate),
                price: formatMoney(locale, BROKER_FEES_ASSUMPTIONS.sharePrice, { currency: "USD", decimals: 0 }),
              })}
            </p>
          </div>

          {/* The ranking as one ledger: a hairline between brokers, no card per row. */}
          <section aria-labelledby="broker-fees-results" className="rounded-card border border-border bg-background p-5 sm:p-6">
            <h3 id="broker-fees-results" className="text-lg font-semibold text-foreground">
              {t(k("result.title"))}
            </h3>
            <div aria-live="polite">
              {errors.length > 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">{t(k("result.invalid"))}</p>
              ) : (
                <ol className="mt-2 divide-y divide-border">
                  {costs.map((cost) => (
                    // Equal totals share a place, so a tie does not read as an order.
                    <CostRow
                      key={cost.broker.id}
                      cost={cost}
                      rank={costs.findIndex((other) => other.total === cost.total && other.missing.length === 0) + 1}
                      scenario={scenario}
                    />
                  ))}
                </ol>
              )}
            </div>
          </section>
        </CalculatorLayout>
      </div>

      <FeeTable />
      <Notices />
    </>
  );
}

function CostRow({ cost, rank, scenario }: { cost: BrokerCost; rank: number; scenario: Scenario }) {
  const { t, eur2, money, percent, orderFee } = useFeeFormat();
  const { broker } = cost;
  const incomplete = cost.missing.length > 0;
  const lines: string[] = [];
  const ordersPlaced = scenario.trades > 0 && scenario.tradeAmount > 0;

  if (ordersPlaced && cost.orderFee) {
    const key = cost.usedSavingsPlan ? "result.tradingPlan" : "result.trading";
    lines.push(t(k(key), { count: String(scenario.trades), amount: money(scenario.tradeAmount), total: eur2(cost.trading) }));
    lines.push(t(k("result.feePerOrder"), { formula: orderFee(cost.orderFee) }));
  } else if (!ordersPlaced) {
    lines.push(t(k("result.noOrders")));
  }
  if (scenario.market === "usStock" && ordersPlaced && broker.fxPct !== null) {
    lines.push(
      t(k("result.fx"), {
        pct: percent(broker.fxPct),
        amount: money(scenario.tradeAmount * scenario.trades),
        total: eur2(cost.fx),
      }),
    );
  }
  if (broker.custody || cost.marketFee > 0) {
    lines.push(
      cost.marketFee > 0
        ? t(k("result.custodyMarket"), { total: eur2(cost.custody), market: eur2(cost.marketFee) })
        : t(k("result.custody"), { total: eur2(cost.custody) }),
    );
  }
  for (const tax of cost.taxes) {
    if (tax.amount > 0) lines.push(t(k(`result.tax.${tax.kind}`), { pct: percent(tax.pct), amount: eur2(tax.amount) }));
  }
  if (incomplete) {
    lines.push(
      t(k("result.missing"), {
        fees: cost.missing.map((item) => t(k(`result.fees.${item}`))).join(", "),
      }),
    );
  }

  return (
    <li className="py-4 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-base font-semibold text-foreground">
          <span className="mr-2 font-mono text-sm text-muted-foreground">{incomplete ? "–" : `${rank}.`}</span>
          {broker.name}
        </p>
        <p className="shrink-0 text-right">
          <span className="block font-mono text-lg font-semibold text-foreground">
            {incomplete ? t(k("result.incompleteTotal"), { total: eur2(cost.total) }) : eur2(cost.total)}
          </span>
          <span className="block text-xs text-muted-foreground">{t(k("result.perYear"))}</span>
        </p>
      </div>
      <ul className="mt-2 space-y-0.5 text-sm text-muted-foreground">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </li>
  );
}

function useBrokerLabels() {
  const format = useFeeFormat();
  const { t, money, percent, orderFee, custody } = format;
  const notPublished = t(k("table.notPublished"));
  // A formula opens a table cell, so it starts with a capital: "No fee", "1 order a month free".
  const cap = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);
  return {
    ...format,
    custodyLabel: (broker: Broker) => (broker.custody ? cap(custody(broker.custody)) : notPublished),
    etfLabel: (broker: Broker) => (broker.etfEu ? cap(orderFee(broker.etfEu)) : notPublished),
    planLabel: (broker: Broker) =>
      broker.etfSavingsPlan ? t(k("table.plan"), { fee: orderFee(broker.etfSavingsPlan) }) : null,
    usLabel: (broker: Broker) => (broker.usStock ? cap(orderFee(broker.usStock)) : notPublished),
    fxLabel: (broker: Broker) => (broker.fxPct === null ? notPublished : broker.fxPct === 0 ? t(k("table.noFx")) : percent(broker.fxPct)),
    cashLabel: (broker: Broker) => {
      const cash = broker.cashInterest;
      if (cash === null) return notPublished;
      if (cash.kind === "none") return t(k("table.noInterest"));
      const rate = t(k("table.interest"), { pct: percent(cash.pct) });
      const bounds: string[] = [];
      if (cash.aboveBalance > 0) bounds.push(t(k("table.interestAbove"), { amount: money(cash.aboveBalance) }));
      if (cash.maxBalance !== null) bounds.push(t(k("table.interestUpTo"), { amount: money(cash.maxBalance) }));
      return bounds.length > 0 ? `${rate}, ${bounds.join(", ")}` : rate;
    },
    protectionLabel: (broker: Broker) => {
      const protection = broker.investorProtection;
      if (!protection) return notPublished;
      const values = { scheme: t(k(`schemes.${protection.scheme}`)), amount: money(protection.amount), pct: percent(protection.coveragePct) };
      return protection.coveragePct < 100 ? t(k("table.protectionPct"), values) : t(k("table.protection"), values);
    },
    depositLabel: (broker: Broker) =>
      broker.depositGuarantee
        ? t(k("table.deposit"), { scheme: t(k(`schemes.${broker.depositGuarantee.scheme}`)), amount: money(broker.depositGuarantee.amount) })
        : null,
    marketFeeLabel: (broker: Broker) =>
      broker.marketFee
        ? t(k("table.marketFee"), {
            fee: money(broker.marketFee.perYear),
            pct: broker.marketFee.maxPctOfPortfolio === null ? "" : percent(broker.marketFee.maxPctOfPortfolio),
          })
        : null,
    feeTaxLabels: (broker: Broker) =>
      broker.feeTaxes.map((tax) =>
        t(k(`table.tax.${tax.kind}`), {
          pct: percent(tax.pct),
          fees: tax.on.map((fee) => t(k(`result.fees.${fee}`))).join(", "),
        }),
      ),
    noteLabel: (broker: Broker) => (broker.note ? t(k(`brokerNotes.${broker.id}`)) : null),
    taxLabel: (broker: Broker) => t(k(`table.ptTax.${broker.ptTaxReport ?? "unknown"}`)),
    countryLabel: (broker: Broker) => t(k(`countries.${broker.country}`)),
  };
}

function Sources({ broker }: { broker: Broker }) {
  const { t, locale } = useTranslations();
  return (
    <>
      <ul className="space-y-0.5">
        {broker.sources.map((source) => (
          <li key={source.url}>
            <a
              href={source.url}
              rel="noopener nofollow"
              target="_blank"
              className="font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80"
            >
              {source.label}
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">
        {t(k("table.checked"), { date: formatCheckedDate(locale, broker.checked) })}
      </p>
    </>
  );
}

/** The sources on one line under a table row: "Source: Preçário (PDF) · Preçário · checked 20 Nov 2026". */
function InlineSources({ broker }: { broker: Broker }) {
  const { t, locale } = useTranslations();
  return (
    <p className="mt-1">
      <span>{t(k("table.columns.source"))}: </span>
      {broker.sources.map((source, index) => (
        <Fragment key={source.url}>
          {index > 0 && " · "}
          <a
            href={source.url}
            rel="noopener nofollow"
            target="_blank"
            className="font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80"
          >
            {source.label}
          </a>
        </Fragment>
      ))}
      <span> · {t(k("table.checked"), { date: formatCheckedDate(locale, broker.checked) })}</span>
    </p>
  );
}

function FeeTable() {
  const labels = useBrokerLabels();
  const { t } = labels;
  const brokers = [...BROKER_FEES].sort((a, b) => a.name.localeCompare(b.name, "en"));
  return (
    <section aria-labelledby="broker-fees-table" className="mt-12">
      <h2 id="broker-fees-table" className="text-2xl font-semibold tracking-tight text-foreground">
        {t(k("table.title"))}
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t(k("table.intro"))}</p>
      <ul className="mt-4 divide-y divide-border rounded-card border border-border bg-background lg:hidden">
        {brokers.map((broker) => (
          <li key={broker.id} className="p-4">
            <p className="text-base font-semibold text-foreground">{broker.name}</p>
            <p className="break-words text-xs text-muted-foreground">
              {broker.entity} · {labels.countryLabel(broker)} · {t(k("table.regulator"), { name: broker.regulator })}
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              <Item
                label={t(k("table.columns.custody"))}
                value={labels.custodyLabel(broker)}
                extra={[labels.marketFeeLabel(broker)]}
              />
              <Item
                label={t(k("table.columns.etfEu"))}
                value={labels.etfLabel(broker)}
                extra={[broker.etfVenue ? t(k("table.venue"), { venue: broker.etfVenue }) : null, labels.planLabel(broker)]}
              />
              <Item
                label={t(k("table.columns.usStock"))}
                value={labels.usLabel(broker)}
              />
              <Item label={t(k("table.columns.fx"))} value={labels.fxLabel(broker)} />
              <Item label={t(k("table.columns.cash"))} value={labels.cashLabel(broker)} />
              <Item
                label={t(k("table.columns.protection"))}
                value={labels.protectionLabel(broker)}
                extra={[labels.depositLabel(broker)]}
              />
              <Item label={t(k("table.columns.tax"))} value={labels.taxLabel(broker)} />
            </dl>
            {labels.feeTaxLabels(broker).map((line) => (
              <p key={line} className="mt-2 text-xs text-muted-foreground">
                {line}
              </p>
            ))}
            {labels.noteLabel(broker) && <p className="mt-2 text-xs text-muted-foreground">{labels.noteLabel(broker)}</p>}
            <div className="mt-3 border-t border-border-2 pt-3 text-sm">
              <Sources broker={broker} />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 hidden overflow-x-auto rounded-lg border border-border lg:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{t(k("table.caption"))}</caption>
          <thead className="bg-paper-2 text-muted-foreground">
            <tr>
              {(["broker", "custody", "etfEu", "usStock", "fx", "cash", "protection", "tax"] as const).map((column) => (
                <th key={column} scope="col" className="px-3 py-2 text-left align-bottom font-medium">
                  {t(k(`table.columns.${column}`))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {brokers.map((broker) => (
              <Fragment key={broker.id}>
                <tr className="border-t border-border-2 align-top">
                  <th scope="row" className="min-w-40 px-3 pt-3 pb-2 text-left font-normal">
                    <span className="block font-semibold text-foreground">{broker.name}</span>
                    <span className="block text-xs text-muted-foreground">{broker.entity}</span>
                    <span className="block text-xs text-muted-foreground">
                      {labels.countryLabel(broker)} · {t(k("table.regulator"), { name: broker.regulator })}
                    </span>
                  </th>
                  <td className="min-w-32 px-3 pt-3 pb-2">
                    {labels.custodyLabel(broker)}
                    {labels.marketFeeLabel(broker) && (
                      <span className="mt-1 block text-xs text-muted-foreground">{labels.marketFeeLabel(broker)}</span>
                    )}
                  </td>
                  <td className="min-w-36 px-3 pt-3 pb-2">
                    {labels.etfLabel(broker)}
                    {broker.etfVenue && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {t(k("table.venue"), { venue: broker.etfVenue })}
                      </span>
                    )}
                    {labels.planLabel(broker) && (
                      <span className="mt-1 block text-xs text-muted-foreground">{labels.planLabel(broker)}</span>
                    )}
                  </td>
                  <td className="min-w-36 px-3 pt-3 pb-2">{labels.usLabel(broker)}</td>
                  <td className="px-3 pt-3 pb-2">{labels.fxLabel(broker)}</td>
                  <td className="min-w-28 px-3 pt-3 pb-2">{labels.cashLabel(broker)}</td>
                  <td className="min-w-40 px-3 pt-3 pb-2">
                    {labels.protectionLabel(broker)}
                    {labels.depositLabel(broker) && (
                      <span className="mt-1 block text-xs text-muted-foreground">{labels.depositLabel(broker)}</span>
                    )}
                  </td>
                  <td className="min-w-32 px-3 pt-3 pb-2">{labels.taxLabel(broker)}</td>
                </tr>
                <tr>
                  <td colSpan={8} className="px-3 pb-3 text-xs text-muted-foreground">
                    {[...labels.feeTaxLabels(broker), labels.noteLabel(broker)]
                      .filter((line): line is string => Boolean(line))
                      .map((line) => (
                        <p key={line} className="max-w-5xl">
                          {line}
                        </p>
                      ))}
                    <InlineSources broker={broker} />
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Item({ label, value, extra = [] }: { label: string; value: string; extra?: (string | null)[] }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">
        {value}
        {extra
          .filter((line): line is string => Boolean(line))
          .map((line) => (
            <span key={line} className="block text-xs text-muted-foreground">
              {line}
            </span>
          ))}
      </dd>
    </div>
  );
}

function Notices() {
  const { t } = useTranslations();
  return (
    <section aria-labelledby="broker-fees-notices" className="mt-12 grid gap-4 md:grid-cols-3">
      <h2 id="broker-fees-notices" className="sr-only">
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

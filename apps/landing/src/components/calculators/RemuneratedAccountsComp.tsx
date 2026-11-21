import { useEffect, useMemo, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import {
  BANK_INTEREST_EXAMPLE_AMOUNT,
  BANK_INTEREST_MAX_AMOUNT,
  BANK_INTEREST_TAX_RATE,
  DEFAULT_REMUNERATED_FILTERS,
  filterRemuneratedAccounts,
  isRateRange,
  projectRow,
  sortRemuneratedAccounts,
  type IbanFilter,
  type NetInterest,
  type RemuneratedFilters,
  type RowProjection,
  type SortKey,
  type TaxFilter,
} from "@/lib/calculators/bankAccounts";
import {
  REMUNERATED_ACCOUNTS,
  type RemuneratedAccount,
  type RemuneratedAccountType,
} from "@/lib/calculators/data/remuneratedAccounts";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatPercent } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { toLocalizedPath } from "@/lib/routes";
import { AsOfBanner, BankNotices, OriginalNotes, YesMark } from "./BankAccountsCommon";

const k = (key: string) => `tools.remuneratedAccounts.${key}`;
const TYPES: readonly RemuneratedAccountType[] = ["ordem", "poupancaComIban", "poupancaSemIban", "dividaPublica", "seguro"];
const IBAN_OPTIONS: readonly IbanFilter[] = ["any", "withIban", "withoutIban"];
const TAX_OPTIONS: readonly TaxFilter[] = ["any", "withheld", "foreign"];
const SORTS: readonly SortKey[] = ["tanbDesc", "tanbAsc", "netDesc"];

export default function RemuneratedAccountsComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <RemuneratedAccounts />
    </ReactTranslationsProvider>
  );
}

function RemuneratedAccounts() {
  const { t, locale } = useTranslations();
  const [amount, setAmount] = useState<number>(BANK_INTEREST_EXAMPLE_AMOUNT);
  const [filters, setFilters] = useState<RemuneratedFilters>({ ...DEFAULT_REMUNERATED_FILTERS });
  const [sort, setSort] = useState<SortKey>("tanbDesc");
  const [touched, setTouched] = useState(false);
  const usageSent = useRef(false);

  useEffect(() => {
    if (!touched || usageSent.current) return;
    usageSent.current = true;
    // Metadata only: never the amount, the filters, the sort or any account.
    pushGtmEvent({ event: "tool_used", tool: "remunerated_accounts", page_type: getPageType() });
  }, [touched]);

  const amountError = Number.isNaN(amount)
    ? "required"
    : amount < 0
      ? "negative"
      : amount > BANK_INTEREST_MAX_AMOUNT
        ? "tooLarge"
        : null;

  const rows = useMemo(() => {
    const filtered = filterRemuneratedAccounts(REMUNERATED_ACCOUNTS, filters);
    const projections: RowProjection[] = [];
    for (const account of filtered) {
      const projection = amountError ? { account, single: null, plans: [], netLow: null, netHigh: null } : projectRow(account, amount);
      if (projection) projections.push(projection);
    }
    // Without a valid amount there is no net figure to sort by; fall back to the rate.
    return sortRemuneratedAccounts(projections, amountError && sort === "netDesc" ? "tanbDesc" : sort);
  }, [amount, amountError, filters, sort]);

  const touch = () => setTouched(true);
  const setFilter = <K extends keyof RemuneratedFilters>(key: K, value: RemuneratedFilters[K]) => {
    touch();
    setFilters((current) => ({ ...current, [key]: value }));
  };
  const eur = (value: number, decimals = 0) => formatMoney(locale, value, { currency: "EUR", decimals });

  const selectClass =
    "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <>
      <AsOfBanner />
      <h2 className="mt-10 text-2xl font-semibold tracking-tight text-foreground">{t(k("calculator.title"))}</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        {t(k("calculator.intro"), { tax: String(BANK_INTEREST_TAX_RATE) })}
      </p>
      <div className="mt-6 grid gap-5 rounded-card border border-border bg-background p-5 shadow-sm sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <CalculatorInput
            id="remunerated-amount"
            label={t(k("fields.amount"))}
            value={amount}
            onChange={(value) => {
              touch();
              setAmount(value);
            }}
            min={0}
            max={BANK_INTEREST_MAX_AMOUNT}
            step={500}
            prefix="€"
            helpText={t(k("help.amount"))}
            error={amountError ? t(k(`errors.amount.${amountError}`), { max: eur(BANK_INTEREST_MAX_AMOUNT) }) : undefined}
          />
        </div>
        <Field id="remunerated-type" label={t(k("filters.type"))}>
          <select
            id="remunerated-type"
            className={selectClass}
            value={filters.type}
            onChange={(event) => setFilter("type", event.currentTarget.value as RemuneratedFilters["type"])}
          >
            <option value="any">{t(k("filters.any"))}</option>
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {t(k(`types.${type}`))}
              </option>
            ))}
          </select>
        </Field>
        <Field id="remunerated-iban" label={t(k("filters.iban"))}>
          <select
            id="remunerated-iban"
            className={selectClass}
            value={filters.iban}
            onChange={(event) => setFilter("iban", event.currentTarget.value as IbanFilter)}
          >
            {IBAN_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t(k(`iban.${option}`))}
              </option>
            ))}
          </select>
        </Field>
        <Field id="remunerated-tax" label={t(k("filters.tax"))}>
          <select
            id="remunerated-tax"
            className={selectClass}
            value={filters.tax}
            onChange={(event) => setFilter("tax", event.currentTarget.value as TaxFilter)}
          >
            {TAX_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t(k(`tax.${option}`))}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex min-h-11 items-center gap-2 self-end text-sm font-medium text-foreground">
          <input
            type="checkbox"
            checked={filters.twoHoldersOnly}
            onChange={(event) => setFilter("twoHoldersOnly", event.currentTarget.checked)}
            className="h-5 w-5 rounded border-input accent-primary"
          />
          {t(k("filters.twoHolders"))}
        </label>
        <Field id="remunerated-sort" label={t(k("sort.label"))}>
          <select
            id="remunerated-sort"
            className={selectClass}
            value={sort}
            onChange={(event) => {
              touch();
              setSort(event.currentTarget.value as SortKey);
            }}
          >
            {SORTS.map((option) => (
              <option key={option} value={option}>
                {t(k(`sort.${option}`))}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">
        {t(k("count"), { shown: String(rows.length), total: String(REMUNERATED_ACCOUNTS.length) })}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{t(k("assumptions"), { tax: String(BANK_INTEREST_TAX_RATE) })}</p>
      {rows.length === 0 && <p className="mt-6 text-sm text-muted-foreground">{t(k("empty"))}</p>}
      <ul className="mt-4 divide-y divide-border rounded-card border border-border bg-background lg:hidden">
        {rows.map((row) => (
          <li key={row.account.id} className={`p-4 ${row.account.highlighted ? "bg-paper-2" : ""}`}>
            <RowCard row={row} showNet={!amountError} />
          </li>
        ))}
      </ul>
      <div className="mt-4 hidden overflow-x-auto rounded-lg border border-border lg:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{t(k("caption"))}</caption>
          <thead className="bg-paper-2 text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("columns.tanb"))}</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">{t(k("columns.account"))}</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">{t(k("columns.limits"))}</th>
              <th scope="col" className="px-3 py-2 text-center font-medium">{t(k("columns.instant"))}</th>
              <th scope="col" className="px-3 py-2 text-center font-medium">{t(k("columns.holders"))}</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">{t(k("columns.tax"))}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(k("columns.net"), { tax: String(BANK_INTEREST_TAX_RATE) })}</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">{t(k("columns.notes"))}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <RowTable key={row.account.id} row={row} showNet={!amountError} />
            ))}
          </tbody>
        </table>
      </div>
      <BankNotices />
    </>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function useLabels() {
  const { t, locale } = useTranslations();
  const eur = (value: number, decimals = 0) => formatMoney(locale, value, { currency: "EUR", decimals });
  const percent = (value: number) => formatPercent(locale, value, { decimals: 2 });
  const rate = (account: RemuneratedAccount) =>
    isRateRange(account)
      ? t(k("rateRange"), { from: percent(account.tanbMin), to: percent(account.tanbMax) })
      : percent(account.tanbMax);
  const term = (account: RemuneratedAccount) =>
    account.termSeeNotes
      ? t(k("seeNotes"))
      : account.termMonths !== null
        ? t(k("months"), { count: String(account.termMonths) })
        : null;
  const bound = (value: number | null, seeNotes: boolean) =>
    value === null ? null : seeNotes ? `${eur(value)} (${t(k("seeNotes"))})` : eur(value);
  const range = (account: RemuneratedAccount) => {
    const min = bound(account.minimum, account.minimumSeeNotes);
    const max = bound(account.maximum, account.maximumSeeNotes);
    return {
      min: min ?? t(k("noLimit")),
      max: max ?? t(k("noLimit")),
    };
  };
  const net = (row: RowProjection) => {
    if (row.single) return eur(row.single.net, 2);
    if (row.netLow === null || row.netHigh === null) return t(k("seeNotes"));
    return t(k("rateRange"), { from: eur(row.netLow, 2), to: eur(row.netHigh, 2) });
  };
  return { t, eur, percent, rate, term, range, net, locale };
}

function TaxBadge({ account }: { account: RemuneratedAccount }) {
  const { t } = useTranslations();
  return account.irsNotWithheld ? (
    <span className="inline-block rounded-full bg-paper-2 px-2 py-0.5 text-xs font-medium text-foreground">
      {t(k("tax.foreignBadge"))}
    </span>
  ) : (
    <span className="text-xs text-muted-foreground">{t(k("tax.withheldBadge"))}</span>
  );
}

function HoldersCell({ account }: { account: RemuneratedAccount }) {
  const { t } = useTranslations();
  if (account.twoHolders === "paidPlan") return <span className="text-xs">{t(k("holdersPaidPlan"))}</span>;
  return <YesMark value={account.twoHolders === "yes"} />;
}

function Caveats({ row }: { row: RowProjection }) {
  const { t, eur } = useLabels();
  const { account } = row;
  const results: NetInterest[] = row.single ? [row.single] : row.plans.map((plan) => plan.result);
  const items: string[] = [];
  if (results.some((result) => result.belowMinimum))
    items.push(t(k("result.belowMinimum"), { min: eur(account.minimum ?? 0) }));
  if (results.some((result) => result.capped))
    items.push(t(k("result.capped"), { max: eur(account.maximum ?? 0) }));
  if (account.termMonths !== null && !account.termSeeNotes && account.termMonths < 12)
    items.push(t(k("result.shortTerm"), { count: String(account.termMonths) }));
  if (account.termSeeNotes) items.push(t(k("result.termNotes")));
  if (items.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function Plans({ row }: { row: RowProjection }) {
  const { t, eur, percent } = useLabels();
  if (row.plans.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-muted-foreground">{t(k("plans.title"))}</p>
      <ul className="mt-1 space-y-0.5 text-sm text-foreground">
        {row.plans.map(({ plan, result }) => (
          <li key={plan.name}>
            {t(k("plans.line"), {
              plan: plan.name,
              rate: percent(plan.ratePct),
              fee: plan.monthlyFee === 0 ? t(k("plans.noFee")) : t(k("plans.fee"), { fee: eur(plan.monthlyFee, 2) }),
              net: eur(result.net, 2),
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProductLink({ account }: { account: RemuneratedAccount }) {
  const { t, locale } = useTranslations();
  if (!account.highlighted) return null;
  return (
    <p className="mt-1 text-xs">
      <a
        href={toLocalizedPath("toolSavingsCertificates", locale)}
        className="font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80"
      >
        {t(k("certificatesLink"))}
      </a>
    </p>
  );
}

function RowCard({ row, showNet }: { row: RowProjection; showNet: boolean }) {
  const { t, rate, term, range, net } = useLabels();
  const { account } = row;
  const { min, max } = range(account);
  const termLabel = term(account);
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-base font-semibold text-foreground">{account.entity}</p>
          <p className="break-words text-sm text-muted-foreground">{account.product}</p>
        </div>
        <p className="shrink-0 text-right font-mono text-xl font-semibold text-foreground">{rate(account)}</p>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {t(k(`types.${account.type}`))}
        {termLabel ? ` · ${t(k("columns.term"))}: ${termLabel}` : ""}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-muted-foreground">{t(k("columns.minimum"))}</dt>
          <dd className="font-mono">{min}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t(k("columns.maximum"))}</dt>
          <dd className="font-mono">{max}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t(k("columns.instant"))}</dt>
          <dd><YesMark value={account.instantTransfer} /></dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t(k("columns.holders"))}</dt>
          <dd><HoldersCell account={account} /></dd>
        </div>
      </dl>
      <p className="mt-2"><TaxBadge account={account} /></p>
      {showNet && (
        <div className="mt-3 border-t border-border-2 pt-3">
          <p className="text-sm text-muted-foreground">{t(k("columns.net"), { tax: String(BANK_INTEREST_TAX_RATE) })}</p>
          <p className="font-mono text-lg font-semibold text-foreground">{net(row)}</p>
          <Caveats row={row} />
        </div>
      )}
      <Plans row={row} />
      <ProductLink account={account} />
      <OriginalNotes notes={account.notes} className="mt-3" />
    </>
  );
}

function RowTable({ row, showNet }: { row: RowProjection; showNet: boolean }) {
  const { t, rate, term, range, net } = useLabels();
  const { account } = row;
  const { min, max } = range(account);
  const termLabel = term(account);
  return (
    <tr className={`border-t border-border-2 align-top ${account.highlighted ? "bg-paper-2" : ""}`}>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono font-semibold text-foreground">{rate(account)}</td>
      <th scope="row" className="min-w-[10rem] px-3 py-3 text-left font-normal">
        <span className="font-semibold text-foreground">{account.entity}</span>
        <span className="block text-muted-foreground">{account.product}</span>
        <span className="block text-xs text-muted-foreground">
          {t(k(`types.${account.type}`))}
          {termLabel ? ` · ${t(k("columns.term"))}: ${termLabel}` : ""}
        </span>
        <ProductLink account={account} />
      </th>
      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">
        {/* The labels in the body face; only the amounts are figures. */}
        <span className="block"><span className="font-sans text-muted-foreground">{t(k("columns.minimum"))}:</span> {min}</span>
        <span className="block"><span className="font-sans text-muted-foreground">{t(k("columns.maximum"))}:</span> {max}</span>
      </td>
      <td className="px-3 py-3 text-center"><YesMark value={account.instantTransfer} /></td>
      <td className="px-3 py-3 text-center"><HoldersCell account={account} /></td>
      <td className="px-3 py-3"><TaxBadge account={account} /></td>
      <td className="px-3 py-3 text-right">
        {showNet ? (
          <>
            <span className="whitespace-nowrap font-mono font-semibold text-foreground">{net(row)}</span>
            <Caveats row={row} />
          </>
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
      </td>
      <td className="min-w-64 px-3 py-3">
        <OriginalNotes notes={account.notes} showLabel={false} />
        {showNet && <Plans row={row} />}
      </td>
    </tr>
  );
}

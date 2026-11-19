import { useEffect, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import {
  ANNUAL_IRS_BRACKETS_2026,
  PAYROLL_LIMITS,
  PAYROLL_REGIONS,
  WITHHOLDING_TABLE_IDS,
  WITHHOLDING_TABLE_SETS,
  computeTableWithholdingCents,
  findRowIndex,
  type PayrollRegion,
  type WithholdingRow,
  type WithholdingTableId,
} from "@/lib/calculators/payroll";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber, formatPercent } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";

const k = (key: string) => `tools.withholdingTables.${key}`;
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface TablesState {
  region: PayrollRegion;
  table: WithholdingTableId;
  /** Monthly remuneration in euros; NaN when the field is empty. */
  remuneration: number;
  dependants: number;
}

const EXAMPLE: TablesState = { region: "mainland", table: "I", remuneration: 1500, dependants: 0 };

export default function WithholdingTablesComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <WithholdingTables />
    </ReactTranslationsProvider>
  );
}

function WithholdingTables() {
  const { t, locale } = useTranslations();
  const [state, setState] = useState(EXAMPLE);
  const used = useRef(false);
  const set = WITHHOLDING_TABLE_SETS[state.region];
  const table = set.tables[state.table];

  const remunerationError =
    !Number.isNaN(state.remuneration) && (state.remuneration < 0 || state.remuneration > PAYROLL_LIMITS.grossMonthly);
  const dependantsError =
    Number.isNaN(state.dependants) || !Number.isInteger(state.dependants) ||
    state.dependants < 0 || state.dependants > PAYROLL_LIMITS.dependants;
  const hasRemuneration = !Number.isNaN(state.remuneration) && !remunerationError && state.remuneration > 0;
  const remunerationCents = Math.round(state.remuneration * 100);
  const activeIndex = hasRemuneration ? findRowIndex(table, remunerationCents) : -1;
  const withholding = hasRemuneration && !dependantsError
    ? computeTableWithholdingCents(table, remunerationCents, state.dependants)
    : null;

  useEffect(() => {
    if (state === EXAMPLE || used.current) return;
    used.current = true;
    // Metadata only: never the remuneration or the result.
    pushGtmEvent({ event: "tool_used", tool: "withholding_tables", page_type: getPageType() });
  }, [state]);

  const money = (cents: number, decimals = 2) => formatMoney(locale, cents / 100, { decimals });
  const rate = (bp: number) => formatPercent(locale, bp / 100, { decimals: 2 });
  const parcela = (row: WithholdingRow) =>
    row.parcela.kind === "fixed"
      ? money(row.parcela.cents)
      : `${rate(row.rateBp)} × ${formatNumber(locale, row.parcela.factorHundredths / 100, 2)} × (${money(row.parcela.ceilingCents)} − R)`;
  const limit = (cents: number | null, index: number) => {
    const previous = index > 0 ? table.rows[index - 1].upToCents : null;
    return cents === null
      ? t(k("columns.above"), { limit: money(previous ?? 0, 0) })
      : t(k("columns.upTo"), { limit: money(cents, 0) });
  };
  const update = <K extends keyof TablesState>(key: K, value: TablesState[K]) =>
    setState((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-6">
      <CalculatorLayout>
        <div className="space-y-5 rounded-card border border-border bg-background p-6">
          <div className="space-y-1.5">
            <label htmlFor="withholding-region" className="block text-sm font-medium text-foreground">
              {t(k("fields.region"))}
            </label>
            <select
              id="withholding-region"
              value={state.region}
              onChange={(event) => update("region", event.currentTarget.value as PayrollRegion)}
              className={selectClass}
            >
              {PAYROLL_REGIONS.map((value) => <option key={value} value={value}>{t(k(`regions.${value}`))}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="withholding-table" className="block text-sm font-medium text-foreground">
              {t(k("fields.table"))}
            </label>
            <select
              id="withholding-table"
              value={state.table}
              onChange={(event) => update("table", event.currentTarget.value as WithholdingTableId)}
              className={selectClass}
            >
              {WITHHOLDING_TABLE_IDS.map((value) => <option key={value} value={value}>{t(k(`tableOptions.${value}`))}</option>)}
            </select>
          </div>
          <CalculatorInput
            id="withholding-remuneration"
            label={t(k("fields.remuneration"))}
            value={state.remuneration}
            onChange={(value) => update("remuneration", value)}
            min={0}
            max={PAYROLL_LIMITS.grossMonthly}
            prefix="€"
            helpText={t(k("remunerationHelp"))}
            error={remunerationError ? t(k("errors.remuneration"), { max: formatMoney(locale, PAYROLL_LIMITS.grossMonthly, { decimals: 0 }) }) : undefined}
          />
          <CalculatorInput
            id="withholding-dependants"
            label={t(k("fields.dependants"))}
            value={state.dependants}
            onChange={(value) => update("dependants", value)}
            min={0}
            max={PAYROLL_LIMITS.dependants}
            error={dependantsError ? t(k("errors.dependants"), { max: String(PAYROLL_LIMITS.dependants) }) : undefined}
          />
        </div>
        <div className="space-y-4 rounded-card border border-border bg-background p-6 lg:sticky lg:top-24">
          <div aria-live="polite" aria-atomic="true">
            {withholding !== null ? (
              <>
                <p className="text-sm text-muted-foreground">{t(k("result.withholding"))}</p>
                <p id="withholding-result" className="font-mono text-3xl font-bold text-primary">{money(withholding)}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t(k("result.row"), { rate: rate(table.rows[activeIndex].rateBp) })}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t(k("result.empty"))}</p>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {t(k("formula"), { dependant: money(table.dependantParcelaCents) })}
          </p>
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{t(k("notFinalTax"))}</p>
        </div>
      </CalculatorLayout>

      <section aria-labelledby="withholding-table-title" className="rounded-card border border-border bg-background p-6">
        <h2 id="withholding-table-title" className="text-xl font-semibold text-foreground">
          {t(k("tableTitle"), { table: state.table, region: t(k(`regions.${state.region}`)) })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(k("tableSource"), { act: set.act, from: set.effectiveFrom, to: set.effectiveTo })}
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <caption className="sr-only">{t(k("tableCaption"))}</caption>
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th scope="col" className="py-2 pr-4 font-medium">{t(k("columns.remuneration"))}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t(k("columns.rate"))}</th>
                <th scope="col" className="py-2 font-medium">{t(k("columns.parcela"))}</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr
                  key={index}
                  aria-current={index === activeIndex ? "true" : undefined}
                  className={index === activeIndex ? "bg-primary/10 font-semibold" : "border-b border-border last:border-0"}
                >
                  <td className="py-2 pr-4 font-mono">{limit(row.upToCents, index)}</td>
                  <td className="py-2 pr-4 font-mono">{rate(row.rateBp)}</td>
                  <td className="py-2 font-mono">{parcela(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="withholding-annual-title" className="rounded-card border border-border bg-background p-6">
        <h2 id="withholding-annual-title" className="text-xl font-semibold text-foreground">{t(k("annual.title"))}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t(k("annual.intro"))}</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t(k("annual.caption"))}</caption>
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th scope="col" className="py-2 pr-4 font-medium">{t(k("annual.income"))}</th>
                <th scope="col" className="py-2 font-medium">{t(k("annual.rate"))}</th>
              </tr>
            </thead>
            <tbody>
              {ANNUAL_IRS_BRACKETS_2026.map((bracket, index) => {
                const previous = index > 0 ? ANNUAL_IRS_BRACKETS_2026[index - 1].upToCents : null;
                return (
                  <tr key={index} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4 font-mono">
                      {bracket.upToCents === null
                        ? t(k("columns.above"), { limit: money(previous ?? 0, 0) })
                        : t(k("columns.upTo"), { limit: money(bracket.upToCents, 0) })}
                    </td>
                    <td className="py-2 font-mono">{rate(bracket.rateBp)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

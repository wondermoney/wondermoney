import { useEffect, useRef, useState } from "react";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";
import {
  NORMAL_AGE_2026_MONTHS,
  SUSTAINABILITY_FACTOR_2026_BP,
  STATE_PENSION_EXAMPLE,
  STATE_PENSION_LIMITS,
  STATE_PENSION_SOURCES,
  computeStatePension,
  type StatePensionInput,
} from "@/lib/calculators/statePension";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney } from "@/lib/numberFormat";
import { toLocalizedPath } from "@/lib/routes";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";

const k = (key: string) => `tools.statePension.${key}`;
export const SIMULATOR_URL = STATE_PENSION_SOURCES.simulator;

export default function StatePensionCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <StatePensionCalculator />
    </ReactTranslationsProvider>
  );
}

function StatePensionCalculator() {
  const { t, locale } = useTranslations();
  const [input, setInput] = useState<StatePensionInput>(STATE_PENSION_EXAMPLE);
  const used = useRef(false);
  const calculation = computeStatePension(input);
  const valid = calculation.ok;
  const errors = calculation.ok ? {} : calculation.errors;
  const result = calculation.ok ? calculation.result : null;

  useEffect(() => {
    if (input === STATE_PENSION_EXAMPLE || !valid || used.current) return;
    used.current = true;
    // Metadata only: never the salary, the years, the age or the result.
    pushGtmEvent({ event: "tool_used", tool: "state_pension", page_type: getPageType() });
  }, [input, valid]);

  const money = (cents: number) => formatMoney(locale, cents / 100, { decimals: 2 });
  const percent = (bp: number, digits = 2) =>
    `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(bp / 100)}%`;
  const update = <K extends keyof StatePensionInput>(key: K, value: StatePensionInput[K]) =>
    setInput((current) => ({ ...current, [key]: value }));
  const err = (field: keyof typeof errors, params?: Record<string, string>) =>
    errors[field] ? t(k(`errors.${errors[field]}`), params) : undefined;
  const l = STATE_PENSION_LIMITS;
  const normalAge = t(k("ageValue"), {
    years: String(Math.floor(NORMAL_AGE_2026_MONTHS / 12)), months: String(NORMAL_AGE_2026_MONTHS % 12),
  });

  const adjustmentText = (() => {
    if (!result) return "";
    if (result.adjustment === "early") {
      return t(k("result.adjustment.early"), {
        months: String(result.adjustmentMonths),
        penalty: percent(result.penaltyBp),
        factor: new Intl.NumberFormat(locale, { minimumFractionDigits: 4 }).format(SUSTAINABILITY_FACTOR_2026_BP / 10_000),
        normal: normalAge,
      });
    }
    if (result.adjustment === "late") {
      return t(k(result.bonusCapped ? "result.adjustment.lateCapped" : "result.adjustment.late"), {
        months: String(result.adjustmentMonths), bonus: percent(result.bonusBp), normal: normalAge,
      });
    }
    return t(k("result.adjustment.none"), { normal: normalAge });
  })();

  return (
    <CalculatorLayout>
      <div className="space-y-5 rounded-card border border-border bg-background p-6">
        <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{t(k("result.estimate"))}</p>
        <CalculatorInput
          id="state-pension-gross"
          label={t(k("fields.grossMonthly"))}
          value={input.grossMonthly}
          onChange={(value) => update("grossMonthly", value)}
          min={0}
          max={l.grossMonthly}
          prefix="€"
          helpText={t(k("help.gross"))}
          error={err("grossMonthly", { min: formatMoney(locale, 0.01, { decimals: 2 }), max: formatMoney(locale, l.grossMonthly, { decimals: 0 }) })}
        />
        <CalculatorInput
          id="state-pension-years"
          label={t(k("fields.years"))}
          value={input.years}
          onChange={(value) => update("years", value)}
          min={0}
          max={l.yearsMax}
          helpText={t(k("help.years"))}
          error={err("years", { min: "15", max: String(Math.max(0, input.ageYears - 16)) })}
        />
        <CalculatorInput
          id="state-pension-age-years"
          label={t(k("fields.ageYears"))}
          value={input.ageYears}
          onChange={(value) => update("ageYears", value)}
          min={60}
          max={70}
          helpText={t(k("help.age"), { normal: normalAge })}
          error={err("ageYears", { min: "60", max: "70" })}
        />
        <CalculatorInput
          id="state-pension-age-months"
          label={t(k("fields.ageMonths"))}
          value={input.ageMonths}
          onChange={(value) => update("ageMonths", value)}
          min={0}
          max={11}
          error={err("ageMonths", { min: "0", max: input.ageYears === 70 ? "0" : "11" })}
        />
      </div>
      <div className="space-y-5 rounded-card border border-border bg-background p-6 lg:sticky lg:top-24">
        <div aria-live="polite" aria-atomic="true">
          {result ? (
            <>
              {/* The answer heads the ledger below, as CalculatorResult sets a leading highlight. */}
              <p className="text-sm font-medium text-foreground">{t(k("result.monthly"))}</p>
              <p
                id="state-pension-monthly"
                className="mt-1 font-mono text-2xl font-semibold leading-tight tracking-tight text-primary sm:text-3xl"
              >
                {money(result.monthlyCents)}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t(k("errors.summary"))}</p>
          )}
        </div>
        {result && (
          <>
            <div className="-mt-2 border-t border-border">
            <CalculatorResult
              items={[
                { label: t(k("result.replacement")), value: percent(result.replacementBp, 1) },
                { label: t(k("result.statutory")), value: money(result.statutoryCents) },
                { label: t(k("result.rate")), value: percent(result.globalRateBp) },
                { label: t(k("result.netPension")), value: money(result.netPensionCents) },
                { label: t(k("result.netPay")), value: money(result.netPayCents) },
                {
                  label: t(k("result.gap")),
                  value: result.gapCents > 0 ? `−${money(result.gapCents)}` : money(0),
                },
              ]}
            />
            </div>
            <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              {adjustmentText}
              {result.floor === "minimum" ? ` ${t(k("result.floorApplied"))}` : ""}
            </p>
            <p className="text-sm text-muted-foreground">
              {result.gapCents > 0 ? t(k("result.gapSome"), { gap: money(result.gapCents) }) : t(k("result.gapNone"))}
            </p>
          </>
        )}
        <p className="text-sm text-muted-foreground">
          {t(k("result.limits"))}{" "}
          <a href={SIMULATOR_URL} rel="noopener" className="font-medium text-primary underline underline-offset-4 hover:opacity-80">
            {t(k("result.simulatorLink"))}
          </a>
        </p>
        <p className="text-sm">
          <a href={toLocalizedPath("pageFireCalculator", locale)} className="font-medium text-primary underline underline-offset-4 hover:opacity-80">
            {t(k("result.fireLink"))}
          </a>
        </p>
      </div>
    </CalculatorLayout>
  );
}

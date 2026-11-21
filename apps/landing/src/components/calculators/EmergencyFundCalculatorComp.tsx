import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorInput from "./CalculatorInput";
import CalculatorResult from "./CalculatorResult";
import {
  EXAMPLE_INPUTS,
  MAX_AMOUNT,
  MAX_MONTHS_OF_COVER,
  MIN_MONTHS_OF_COVER,
  MONTHS_OF_COVER_PRESETS,
  computeEmergencyFund,
  targetMonthFrom,
  type EmergencyFundResult,
} from "@/lib/calculators/emergencyFund";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber, toIntlLocale } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { cn } from "@/lib/utils";

/**
 * Quiet time after an edit before `tool_used` fires, so the outcome it reports
 * is not read halfway through typing a number.
 */
const USAGE_SETTLE_MS = 1500;

export default function EmergencyFundCalculatorComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <EmergencyFundCalculatorContent />
    </ReactTranslationsProvider>
  );
}

function EmergencyFundCalculatorContent() {
  const { t, locale } = useTranslations();

  const [monthlyExpenses, setMonthlyExpenses] = useState<number>(EXAMPLE_INPUTS.monthlyExpenses);
  const [monthsOfCover, setMonthsOfCover] = useState<number>(EXAMPLE_INPUTS.monthsOfCover);
  const [currentSavings, setCurrentSavings] = useState<number>(EXAMPLE_INPUTS.currentSavings);
  const [monthlyContribution, setMonthlyContribution] = useState<number>(
    EXAMPLE_INPUTS.monthlyContribution,
  );

  // The page is prerendered, so "today" is only known in the browser. Until
  // then the target month shows a dash rather than the build date.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const result = useMemo(
    () =>
      computeEmergencyFund({
        monthlyExpenses,
        monthsOfCover,
        currentSavings,
        monthlyContribution,
      }),
    [monthlyExpenses, monthsOfCover, currentSavings, monthlyContribution],
  );

  // Use means the visitor's own calculation, so the starting example does not
  // count until they change an input.
  const edited = useRef(false);
  const edit = (setter: (value: number) => void) => (value: number) => {
    edited.current = true;
    setter(value);
  };
  useUsageTracking(result, edited);

  const money = (value: number) =>
    formatMoney(locale, value, { decimals: Number.isInteger(value) ? 0 : 2 });
  const monthsLabel = (count: number) =>
    count === 1
      ? t("tools.emergencyFund.monthsCountOne")
      : t("tools.emergencyFund.monthsCount", { count: formatNumber(locale, count) });

  // The target is the answer, so it heads the ledger.
  const resultItems = [
    { label: t("tools.emergencyFund.target"), value: money(result.target), highlight: true },
    result.status === "reached"
      ? { label: t("tools.emergencyFund.surplus"), value: money(result.surplus) }
      : { label: t("tools.emergencyFund.shortfall"), value: money(result.shortfall) },
    {
      label: t("tools.emergencyFund.monthsToTarget"),
      value: timeToTargetLabel(result, monthsLabel, t),
      text: true,
    },
    {
      label: t("tools.emergencyFund.targetMonth"),
      value: targetMonthLabel(result, now, locale, t),
      text: true,
    },
  ];

  const statusMessage = statusMessageFor(result, { t, money, monthsLabel });
  const isWarning = result.status === "noContribution" || result.status === "beyondHorizon";

  return (
    <CalculatorLayout>
      <div className="space-y-5 rounded-card border border-border bg-background p-6 shadow-sm">
        <CalculatorInput
          id="emergencyMonthlyExpenses"
          label={t("tools.emergencyFund.monthlyExpenses")}
          value={monthlyExpenses}
          onChange={edit(setMonthlyExpenses)}
          min={0}
          max={MAX_AMOUNT}
          step={50}
          prefix={"€"}
          helpText={t("tools.emergencyFund.monthlyExpensesHelp")}
        />
        {/* On leaving the field, show the 1–24 whole months the result uses. */}
        <div className="space-y-2" onBlur={() => setMonthsOfCover(result.monthsOfCover)}>
          <CalculatorInput
            id="emergencyMonthsOfCover"
            label={t("tools.emergencyFund.monthsOfCover")}
            value={monthsOfCover}
            onChange={edit(setMonthsOfCover)}
            min={MIN_MONTHS_OF_COVER}
            max={MAX_MONTHS_OF_COVER}
            step={1}
            suffix={t("tools.emergencyFund.monthsSuffix")}
            helpText={t("tools.emergencyFund.monthsOfCoverHelp")}
          />
          <div
            role="group"
            aria-label={t("tools.emergencyFund.presetsLabel")}
            className="flex flex-wrap gap-2"
          >
            {MONTHS_OF_COVER_PRESETS.map((preset) => {
              const active = result.monthsOfCover === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={active}
                  onClick={() => edit(setMonthsOfCover)(preset)}
                  className={cn(
                    "h-9 rounded-md border px-3 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    active
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-input bg-background text-foreground hover:bg-accent",
                  )}
                >
                  {monthsLabel(preset)}
                </button>
              );
            })}
          </div>
        </div>
        <CalculatorInput
          id="emergencyCurrentSavings"
          label={t("tools.emergencyFund.currentSavings")}
          value={currentSavings}
          onChange={edit(setCurrentSavings)}
          min={0}
          max={MAX_AMOUNT}
          step={100}
          prefix={"€"}
          helpText={t("tools.emergencyFund.currentSavingsHelp")}
        />
        <CalculatorInput
          id="emergencyMonthlyContribution"
          label={t("tools.emergencyFund.monthlyContribution")}
          value={monthlyContribution}
          onChange={edit(setMonthlyContribution)}
          min={0}
          max={MAX_AMOUNT}
          step={25}
          prefix={"€"}
          helpText={t("tools.emergencyFund.monthlyContributionHelp")}
        />
      </div>

      <div className="space-y-6 rounded-card border border-border bg-background p-6 shadow-sm sticky top-20 lg:top-24">
        <CalculatorResult items={resultItems} />

        <p
          aria-live="polite"
          className={cn(
            "rounded-md bg-muted px-4 py-3 text-sm leading-6",
            isWarning ? "text-warning-text" : "text-foreground",
          )}
        >
          {statusMessage}
        </p>

        <div className="space-y-2 border-t border-border pt-4 text-sm leading-6 text-muted-foreground">
          <p className="font-medium text-foreground">{t("tools.emergencyFund.guidanceTitle")}</p>
          <p>
            {result.status === "noExpenses"
              ? t("tools.emergencyFund.guidanceRangeGeneric")
              : t("tools.emergencyFund.guidanceRange", {
                  low: money(result.rangeLow),
                  high: money(result.rangeHigh),
                })}
          </p>
          <p>{t("tools.emergencyFund.guidanceHigher")}</p>
          <p>{t("tools.emergencyFund.noInterest")}</p>
          {result.capped && (
            <p className="text-warning-text">
              {t("tools.emergencyFund.capped", { max: money(MAX_AMOUNT) })}
            </p>
          )}
        </div>
      </div>
    </CalculatorLayout>
  );
}

type Translate = ReturnType<typeof useTranslations>["t"];

/**
 * One `tool_used` event per page view, the shared landing tool event
 * (`tool`, `page_type`), fired after the first edit once the input settles. It
 * also carries the outcome and the months of cover, never the amounts.
 */
function useUsageTracking(result: EmergencyFundResult, edited: RefObject<boolean>) {
  const tracked = useRef(false);

  useEffect(() => {
    if (!edited.current || tracked.current) return;
    const timer = window.setTimeout(() => {
      tracked.current = true;
      pushGtmEvent({
        event: "tool_used",
        tool: "emergency_fund",
        status: result.status,
        months_of_cover: result.monthsOfCover,
        page_type: getPageType(),
      });
    }, USAGE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [result, edited]);
}

function timeToTargetLabel(
  result: EmergencyFundResult,
  monthsLabel: (count: number) => string,
  t: Translate,
): string {
  switch (result.status) {
    case "noExpenses":
      return "—";
    case "reached":
      return t("tools.emergencyFund.alreadyThere");
    case "noContribution":
      return t("tools.emergencyFund.never");
    case "beyondHorizon":
      return t("tools.emergencyFund.overHundredYears");
    case "onTrack":
      return monthsLabel(result.monthsToTarget ?? 0);
  }
}

function targetMonthLabel(
  result: EmergencyFundResult,
  now: Date | null,
  locale: Lang,
  t: Translate,
): string {
  if (result.status === "reached") return t("tools.emergencyFund.now");
  if (result.status !== "onTrack" || result.monthsToTarget === null || !now) return "—";
  // The long month name: some engines render pt-PT's short form as "11/2028".
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(targetMonthFrom(now, result.monthsToTarget));
}

function statusMessageFor(
  result: EmergencyFundResult,
  {
    t,
    money,
    monthsLabel,
  }: {
    t: Translate;
    money: (value: number) => string;
    monthsLabel: (count: number) => string;
  },
): string {
  switch (result.status) {
    case "noExpenses":
      return t("tools.emergencyFund.statusNoExpenses");
    case "reached":
      return t("tools.emergencyFund.statusReached", {
        months: monthsLabel(result.monthsOfCover),
      });
    case "noContribution":
      return t("tools.emergencyFund.statusNoContribution", { savings: money(result.currentSavings) });
    case "beyondHorizon":
      return t("tools.emergencyFund.statusBeyondHorizon", {
        contribution: money(result.monthlyContribution),
      });
    case "onTrack":
      return t("tools.emergencyFund.statusOnTrack", {
        contribution: money(result.monthlyContribution),
        shortfall: money(result.shortfall),
        months: monthsLabel(result.monthsToTarget ?? 0),
      });
  }
}

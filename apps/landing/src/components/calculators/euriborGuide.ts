/**
 * The Euribor guide's worked example for one locale (EuriborGuide.astro): its values and the
 * payment before and after the change as figures. Every figure comes from
 * `computeEuriborImpact` on the example the calculator starts from, with the latest monthly
 * average in the data.
 */
import { CalendarClock, Plus, TrendingUp } from "lucide-react";
import { EURIBOR_EXAMPLE, EURIBOR_SOURCE, computeEuriborImpact, getLatestEuribor } from "@/lib/calculators/euribor";
import { formatMoney, formatNumber, formatPercent, toIntlLocale } from "@/lib/numberFormat";
import type { Lang } from "@/lib/routes";
import { getTranslations } from "@/lib/translations";
import type { GuideFigure } from "./guideBlocks";

export function buildEuriborGuide(locale: Lang) {
  const t = getTranslations(locale);
  const outcome = computeEuriborImpact(EURIBOR_EXAMPLE);
  if (!outcome.ok) throw new Error("The Euribor worked example has invalid inputs");
  const { revision, indexRate, newIndexRate } = outcome.result;

  const [year, monthNumber] = getLatestEuribor().month.split("-").map(Number);
  const month = new Intl.DateTimeFormat(toIntlLocale(locale), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));

  const euros = (value: number, decimals = 0) => formatMoney(locale, value, { decimals });
  const values = {
    month,
    fetched: EURIBOR_SOURCE.fetchedOn,
    balance: euros(EURIBOR_EXAMPLE.balance),
    years: String(EURIBOR_EXAMPLE.termYears),
    spread: formatPercent(locale, EURIBOR_EXAMPLE.spread, { decimals: 2 }),
    index: formatPercent(locale, indexRate, { decimals: 2 }),
    newIndex: formatPercent(locale, newIndexRate, { decimals: 2 }),
    change: formatNumber(locale, EURIBOR_EXAMPLE.change, 2),
    current: euros(revision.current.monthlyPayment, 2),
    revised: euros(revision.revised.monthlyPayment, 2),
    difference: euros(revision.monthlyChange, 2),
  };

  // Today's payment plus the change is the payment after it, as the calculator shows.
  const sign = revision.monthlyChange > 0 ? "+" : "";
  const payment: GuideFigure[] = [
    { label: t("tools.euribor.result.current"), value: values.current, icon: CalendarClock },
    { label: t("tools.euribor.result.monthlyChange"), value: `${sign}${values.difference}`, icon: Plus },
    { label: t("tools.euribor.result.revised"), value: values.revised, icon: TrendingUp },
  ];

  return { values, payment };
}

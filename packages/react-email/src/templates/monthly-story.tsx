import { Column, Hr, Row, Section, Text } from "react-email";

import { LifecycleEmailLayout } from "../../emails/components/LifecycleEmail";
import { resolveBrandName } from "../components/Brand";
import { buildCampaignUrl } from "../../emails/lib/urls";
import { ComparisonBar, DeltaPillRow, MetricsPanel, StatusPanel } from "../components/LifecycleVisuals";
import type { MonthlyStoryDataSufficientProps, MonthlyStoryInsufficientDataProps, MonthlyStoryProps, TransactionalEmailLanguage } from "../types";

export type { MonthlyStoryCategoryDelta, MonthlyStoryDataSufficientProps, MonthlyStoryInsufficientDataProps, MonthlyStoryMetric, MonthlyStoryProps, MonthlyStoryRecurringChange } from "../types";

const COPY = {
  en: {
    heading: "Your money story this month",
    insufficientHeading: "Building your money story",
    insufficientBody: (monthsNeeded: number) => `We need ${monthsNeeded} more month${monthsNeeded === 1 ? "" : "s"} of history before we can compare this month to your usual. Once we have it, your story will start showing up here.`,
    zeroActivityBody: "We didn't find any transactions for this month, so there's nothing to compare yet. If this looks wrong, check that your accounts are still connected.",
    income: "Income vs. usual",
    spending: "Spending vs. usual",
    usual: "Usual",
    previousValue: (formattedBaseline: string) => `was ${formattedBaseline}`,
    metricsSummary: "Your numbers",
    categoryChanges: "What changed the most",
    recurringChanges: "Recurring payments",
    recurringNew: "New",
    budgetPressure: "Budget pressure",
    savingsRate: "Savings rate",
    netWorth: "Net worth",
    ctaLabel: "See your reports",
    marketingFooterText: (brand: string) => `You're receiving this because you turned on the monthly money story in ${brand}.`,
    dataContext: "Based on the transactions currently available.",
  },
  pt: {
    heading: "A tua história financeira deste mês",
    insufficientHeading: "A construir a tua história financeira",
    insufficientBody: (monthsNeeded: number) => `Precisamos de mais ${monthsNeeded} ${monthsNeeded === 1 ? "mês" : "meses"} de histórico antes de podermos comparar este mês com o teu habitual. Assim que tivermos, a tua história vai começar a aparecer aqui.`,
    zeroActivityBody: "Não encontrámos transações para este mês, por isso ainda não há nada para comparar. Se isto não fizer sentido, confirma se as tuas contas continuam ligadas.",
    income: "Rendimento vs. habitual",
    spending: "Gastos vs. habitual",
    usual: "Habitual",
    previousValue: (formattedBaseline: string) => `era ${formattedBaseline}`,
    metricsSummary: "Os teus números",
    categoryChanges: "O que mais mudou",
    recurringChanges: "Pagamentos recorrentes",
    recurringNew: "Novo",
    budgetPressure: "Pressão no orçamento",
    savingsRate: "Taxa de poupança",
    netWorth: "Património",
    ctaLabel: "Ver os teus relatórios",
    marketingFooterText: (brand: string) => `Recebeste este email porque ativaste a história financeira mensal na ${brand}.`,
    dataContext: "Com base nas transações atualmente disponíveis.",
  },
} as const satisfies Record<TransactionalEmailLanguage, unknown>;

export function getMonthlyStorySubject(props: Pick<MonthlyStoryProps, "language" | "monthLabel" | "status">) {
  const t = COPY[props.language];
  return props.status === "sufficient" ? `${t.heading}: ${props.monthLabel}` : t.insufficientHeading;
}

export function getMonthlyStoryPreheader(props: MonthlyStoryProps) {
  const t = COPY[props.language];
  if (props.status === "insufficient") return props.reason === "zero_activity" ? t.zeroActivityBody : t.insufficientBody(props.monthsNeeded);
  return props.narrativeSentences[0] ?? t.heading;
}

function widthPercent(baseline: number, subject: number): [number, number] {
  const max = Math.max(baseline, subject, 1);
  return [Math.round((baseline / max) * 100), Math.round((subject / max) * 100)];
}

/**
 * Parses a pre-formatted money string (e.g. `formatMoney` output) back into a
 * plain number, honoring the thousands/decimal separator convention of the
 * given language. `en` uses `,` for thousands and `.` for decimals (e.g.
 * `"1,200.50"`); `pt` uses `.` for thousands and `,` for decimals (e.g.
 * `"1.200,50 €"`) — a locale-blind digit strip mis-parses either one.
 */
function parseFormattedAmount(formatted: string, language: TransactionalEmailLanguage): number {
  const digitsAndSeparators = formatted.replace(/[^\d.,-]/g, "");
  const normalized = language === "pt" ? digitsAndSeparators.replaceAll(".", "").replace(",", ".") : digitsAndSeparators.replaceAll(",", "");
  return Number(normalized) || 0;
}

function metricDetail(metric: { detail?: string; formattedBaseline?: string }, previousValue: (formattedBaseline: string) => string): string | undefined {
  const parts = [metric.detail, metric.formattedBaseline ? previousValue(metric.formattedBaseline) : undefined].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function SufficientBody({ language, ...props }: MonthlyStoryDataSufficientProps) {
  const t = COPY[language];
  const brand = resolveBrandName(props.brandName);
  const trackedCtaUrl = buildCampaignUrl({ destinationUrl: props.ctaUrl, nextPath: `/${language}/reports`, utmSource: "mailjet", utmMedium: "email", utmCampaign: "monthly_story", utmContent: "monthly_story" });
  const [incomeBaselineWidth, incomeSubjectWidth] = widthPercent(parseFormattedAmount(props.formattedIncomeBaseline, language), parseFormattedAmount(props.formattedIncomeSubject, language));
  const [spendingBaselineWidth, spendingSubjectWidth] = widthPercent(parseFormattedAmount(props.formattedSpendingBaseline, language), parseFormattedAmount(props.formattedSpendingSubject, language));

  return (
    <LifecycleEmailLayout
      language={language}
      preview={getMonthlyStoryPreheader({ language, ...props, status: "sufficient" })}
      firstName={props.firstName}
      heading={t.heading}
      intro={props.narrativeSentences.join(" ")}
      visual={
        <Section>
          <ComparisonBar title={t.income} rows={[{ formattedValue: props.formattedIncomeBaseline, label: t.usual, widthPercent: incomeBaselineWidth }, { formattedValue: props.formattedIncomeSubject, label: props.monthLabel, widthPercent: incomeSubjectWidth }]} />
          <Section className="mt-[14px]">
            <ComparisonBar title={t.spending} rows={[{ formattedValue: props.formattedSpendingBaseline, label: t.usual, widthPercent: spendingBaselineWidth }, { formattedValue: props.formattedSpendingSubject, label: props.monthLabel, widthPercent: spendingSubjectWidth }]} />
          </Section>
          {props.categoryDeltas.length > 0 ? (
            <Section className="mt-[14px] rounded-[10px] border border-solid border-[#e5e7eb] bg-white px-[18px] py-[16px]">
              <Text className="m-0 font-sans text-[12px] font-medium leading-[18px] text-[#374151]">{t.categoryChanges}</Text>
              <Hr className="my-[11px] border-[#f0f1f3]" />
              <DeltaPillRow deltas={props.categoryDeltas} />
            </Section>
          ) : null}
          {props.recurringChanges.length > 0 ? (
            <Section className="mt-[14px] rounded-[10px] border border-solid border-[#e5e7eb] bg-white px-[18px] py-[16px]">
              <Text className="m-0 font-sans text-[12px] font-medium leading-[18px] text-[#374151]">{t.recurringChanges}</Text>
              <Hr className="my-[11px] border-[#f0f1f3]" />
              {props.recurringChanges.map((change, index) => (
                <Row key={change.displayName} className={index < props.recurringChanges.length - 1 ? "mb-[8px]" : ""}>
                  <Column>
                    <Text className="m-0 font-sans text-[13px] leading-[20px] text-[#111111]">{change.displayName}</Text>
                  </Column>
                  <Column align="right">
                    <Text className="m-0 font-mono text-[12px] leading-[18px] text-[#6b7280]">
                      {change.kind === "new" ? `${t.recurringNew} · ${change.formattedNewAmount}` : `${change.formattedPreviousAmount} → ${change.formattedNewAmount}`}
                    </Text>
                  </Column>
                </Row>
              ))}
            </Section>
          ) : null}
          {props.budgetPressureStatus ? (
            <Section className="mt-[14px]">
              <StatusPanel label={t.budgetPressure} status={props.budgetPressureStatus} detail={props.budgetPressureDetail ?? ""} />
            </Section>
          ) : null}
          {props.savingsRateMetric || props.netWorthMetric ? (
            <Section className="mt-[14px]">
              <MetricsPanel
                title={t.metricsSummary}
                metrics={[
                  props.savingsRateMetric ? { label: t.savingsRate, value: props.savingsRateMetric.formattedValue, detail: metricDetail(props.savingsRateMetric, t.previousValue), tone: props.savingsRateMetric.tone } : null,
                  props.netWorthMetric ? { label: t.netWorth, value: props.netWorthMetric.formattedValue, detail: metricDetail(props.netWorthMetric, t.previousValue), tone: props.netWorthMetric.tone } : null,
                ].filter((metric): metric is NonNullable<typeof metric> => metric != null)}
              />
            </Section>
          ) : null}
        </Section>
      }
      ctaLabel={t.ctaLabel}
      ctaUrl={trackedCtaUrl}
      marketingFooterText={t.marketingFooterText(brand)}
      brandName={brand}
      settingsUrl={props.settingsUrl}
      privacyUrl={props.privacyUrl}
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <p className="m-0">{t.dataContext}</p>
    </LifecycleEmailLayout>
  );
}

function InsufficientBody({ language, ...props }: MonthlyStoryInsufficientDataProps) {
  const t = COPY[language];
  const brand = resolveBrandName(props.brandName);
  const trackedCtaUrl = buildCampaignUrl({ destinationUrl: props.ctaUrl, nextPath: `/${language}/reports`, utmSource: "mailjet", utmMedium: "email", utmCampaign: "monthly_story", utmContent: "monthly_story_insufficient" });
  const body = props.reason === "zero_activity" ? t.zeroActivityBody : t.insufficientBody(props.monthsNeeded);

  return (
    <LifecycleEmailLayout
      language={language}
      preview={getMonthlyStoryPreheader({ language, ...props, status: "insufficient" })}
      firstName={props.firstName}
      heading={t.insufficientHeading}
      intro={body}
      visual={
        props.formattedIncomeSubject || props.formattedSpendingSubject ? (
          <MetricsPanel
            title={props.monthLabel}
            metrics={[props.formattedIncomeSubject ? { label: t.income, value: props.formattedIncomeSubject } : null, props.formattedSpendingSubject ? { label: t.spending, value: props.formattedSpendingSubject } : null].filter((metric): metric is NonNullable<typeof metric> => metric != null)}
          />
        ) : undefined
      }
      ctaLabel={t.ctaLabel}
      ctaUrl={trackedCtaUrl}
      marketingFooterText={t.marketingFooterText(brand)}
      brandName={brand}
      settingsUrl={props.settingsUrl}
      privacyUrl={props.privacyUrl}
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <p className="m-0">{t.dataContext}</p>
    </LifecycleEmailLayout>
  );
}

export default function MonthlyStory(props: MonthlyStoryProps) {
  return props.status === "sufficient" ? <SufficientBody {...props} /> : <InsufficientBody {...props} />;
}

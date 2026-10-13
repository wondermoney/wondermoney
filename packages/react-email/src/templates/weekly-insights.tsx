import { Column, Hr, Row, Section, Text } from "react-email";

import { LifecycleEmailLayout } from "../../emails/components/LifecycleEmail";
import { buildCampaignUrl } from "../../emails/lib/urls";
import type { TransactionalEmailLanguage, WeeklyBudgetSummary, WeeklyInsightsProps } from "../types";
import { getWeeklyInsightsPreheader } from "../weekly-insights-preheader";

export type { WeeklyBudgetSummary, WeeklyInsightsProps } from "../types";
export { getWeeklyInsightsPreheader } from "../weekly-insights-preheader";

const COPY = {
  en: {
    subject: "Your weekly money summary",
    heading: "Your weekly money summary",
    intro: (weekDateRange: string) => `Completed week of ${weekDateRange}. The key points to see where the recorded activity was concentrated.`,
    ariaSummary: (weekDateRange: string) => `Financial summary for the week of ${weekDateRange}`,
    totalSpending: "Total spending",
    topCategory: "Top category",
    budgets: "Budgets",
    budgetStatus: { over: "Some categories are over plan", near: "Some categories are close to the set amount", within: "Within the planned amounts" },
    budgetCount: { within: (n: number) => `${n} within plan`, near: (n: number) => `${n} close to set`, over: (n: number) => `${n} over plan` },
    ctaLabel: "View summary",
    marketingFooterText: "You're receiving this summary because you turned on weekly insights in WonderMoney.",
    bodyParagraph: "In the full summary you can review the transactions included and see the detail of the categories and budgets shown.",
  },
  pt: {
    subject: "O resumo da tua semana financeira",
    heading: "O resumo da tua semana financeira",
    intro: (weekDateRange: string) => `Semana completa de ${weekDateRange}. Os principais pontos para perceberes onde se concentrou a atividade registada.`,
    ariaSummary: (weekDateRange: string) => `Resumo financeiro da semana de ${weekDateRange}`,
    totalSpending: "Total de gastos",
    topCategory: "Categoria com maior valor",
    budgets: "Orçamentos",
    budgetStatus: { over: "Há categorias acima do valor planeado", near: "Há categorias perto do valor definido", within: "Dentro dos valores planeados" },
    budgetCount: { within: (n: number) => `${n} dentro do planeado`, near: (n: number) => `${n} perto do definido`, over: (n: number) => `${n} acima do planeado` },
    ctaLabel: "Ver resumo",
    marketingFooterText: "Recebeste este resumo porque ativaste os insights semanais na WonderMoney.",
    bodyParagraph: "No resumo completo podes rever as transações incluídas e consultar o detalhe das categorias e dos orçamentos apresentados.",
  },
} as const satisfies Record<TransactionalEmailLanguage, unknown>;

export function getWeeklyInsightsSubject(language: TransactionalEmailLanguage = "pt") {
  return COPY[language].subject;
}

export const subject = getWeeklyInsightsSubject();

interface InsightRowProps {
  label: string;
  value: string;
  detail?: string;
  valueMono?: boolean;
}

function InsightRow({ label, value, detail, valueMono = true }: InsightRowProps) {
  return (
    <Row>
      <Column style={{ verticalAlign: "top" }}>
        <Text className="m-0 font-sans text-[12px] leading-[18px] text-[#6b7280]">{label}</Text>
        {detail ? (
          <Text className="m-0 mt-[3px] font-sans text-[11px] leading-[17px] text-[#4b5563]">{detail}</Text>
        ) : null}
      </Column>
      <Column align="right" style={{ verticalAlign: "top", width: "170px" }}>
        <Text className={`m-0 ${valueMono ? "font-mono" : "font-sans"} text-[16px] font-semibold leading-[22px] text-[#111111]`}>{value}</Text>
      </Column>
    </Row>
  );
}

function getBudgetStatusCopy(summary: WeeklyBudgetSummary, language: TransactionalEmailLanguage) {
  const t = COPY[language].budgetStatus;
  if (summary.status === "over") return t.over;
  if (summary.status === "near") return t.near;
  return t.within;
}

function getBudgetCountDetail(summary: WeeklyBudgetSummary, language: TransactionalEmailLanguage) {
  const t = COPY[language].budgetCount;
  const parts: string[] = [];
  if (summary.withinPlanCount !== undefined) parts.push(t.within(summary.withinPlanCount));
  if (summary.nearCount !== undefined) parts.push(t.near(summary.nearCount));
  if (summary.overCount !== undefined) parts.push(t.over(summary.overCount));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export default function WeeklyInsights({
  language = "pt",
  firstName,
  weekDateRange,
  formattedTotalSpending,
  previousWeekComparisonText,
  previousWeekComparisonValue,
  topCategoryDisplay,
  formattedTopCategoryAmount,
  budgetSummary,
  dataContext,
  ctaUrl,
  settingsUrl,
  privacyUrl,
  unsubscribeUrl,
  utmSource = "mailjet",
  utmMedium = "email",
  utmCampaign = "weekly_insights",
  utmContent = "completed_lisbon_week",
}: WeeklyInsightsProps) {
  const t = COPY[language];
  const preheader = getWeeklyInsightsPreheader(budgetSummary, language);
  const comparisonDetail =
    previousWeekComparisonText?.trim() && previousWeekComparisonValue?.trim()
      ? `${previousWeekComparisonText}: ${previousWeekComparisonValue}`
      : undefined;
  const trackedCtaUrl = buildCampaignUrl({
    destinationUrl: ctaUrl,
    nextPath: `/${language}`,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
  });
  return (
    <LifecycleEmailLayout
      language={language}
      preview={preheader}
      firstName={firstName}
      heading={t.heading}
      intro={t.intro(weekDateRange)}
      visual={
        <Section aria-label={t.ariaSummary(weekDateRange)}>
          <InsightRow
            label={t.totalSpending}
            value={formattedTotalSpending}
            detail={comparisonDetail}
          />
          <Hr className="my-[15px] border-[#e5e7eb]" />
          <InsightRow
            label={t.topCategory}
            value={formattedTopCategoryAmount}
            detail={topCategoryDisplay}
          />
          {budgetSummary ? (
            <>
              <Hr className="my-[15px] border-[#e5e7eb]" />
              <InsightRow
                label={t.budgets}
                value={getBudgetStatusCopy(budgetSummary, language)}
                detail={getBudgetCountDetail(budgetSummary, language)}
                valueMono={false}
              />
            </>
          ) : null}
        </Section>
      }
      ctaLabel={t.ctaLabel}
      ctaUrl={trackedCtaUrl}
      marketingFooterText={t.marketingFooterText}
      settingsUrl={settingsUrl}
      privacyUrl={privacyUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <p className="m-0">{dataContext}</p>
      <p className="m-0 mt-[10px]">{t.bodyParagraph}</p>
    </LifecycleEmailLayout>
  );
}

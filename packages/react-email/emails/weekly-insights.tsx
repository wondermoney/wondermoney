import WeeklyInsights, {
  type WeeklyInsightsProps,
} from "../src/templates/weekly-insights";

export * from "../src/templates/weekly-insights";

function WeeklyInsightsPreview(props: WeeklyInsightsProps) {
  return <WeeklyInsights {...props} />;
}

WeeklyInsightsPreview.PreviewProps = {
  firstName: "Marta",
  weekDateRange: "6 a 12 de julho de 2026",
  formattedTotalSpending: "€436,80",
  previousWeekComparisonText: "Comparação com a semana anterior",
  previousWeekComparisonValue: "€38,20 abaixo",
  topCategoryDisplay: "Alimentação · Supermercado",
  formattedTopCategoryAmount: "€168,45",
  budgetSummary: {
    status: "near",
    withinPlanCount: 5,
    nearCount: 2,
    overCount: 0,
  },
  dataContext: "Os valores usam as transações atualmente disponíveis na tua conta.",
  ctaUrl: "https://app.wonder.money/pt",
  settingsUrl: "https://app.wonder.money/pt/settings?tab=notifications",
  privacyUrl: "https://docs.wonder.money/pt/about/privacy-policy",
  unsubscribeUrl: "https://app.wonder.money/pt/email/unsubscribe/EXEMPLO",
} satisfies WeeklyInsightsProps;

export default WeeklyInsightsPreview;

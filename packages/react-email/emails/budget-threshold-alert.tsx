import BudgetThresholdAlert, {
  type BudgetThresholdAlertProps,
} from "../src/templates/budget-threshold-alert";

export * from "../src/templates/budget-threshold-alert";

function BudgetThresholdAlertPreview(props: BudgetThresholdAlertProps) {
  return <BudgetThresholdAlert {...props} />;
}

BudgetThresholdAlertPreview.PreviewProps = {
  firstName: "Marta",
  periodLabel: "julho de 2026",
  items: [
    {
      budgetName: "Casa",
      categoryName: "Supermercado",
      state: "over",
      threshold: 100,
      formattedPercentageUsed: "107%",
      formattedSpent: "€428,30",
      formattedBudgeted: "€400,00",
      formattedRemainingOrOver: "€28,30",
    },
    {
      budgetName: "Despesas mensais",
      categoryName: "Transportes",
      state: "at_limit",
      threshold: 100,
      formattedPercentageUsed: "100%",
      formattedSpent: "€120,00",
      formattedBudgeted: "€120,00",
      formattedRemainingOrOver: "€0,00",
    },
    {
      budgetName: "Família",
      categoryName: "Atividades",
      state: "near",
      threshold: 80,
      formattedPercentageUsed: "80%",
      formattedSpent: "€72,00",
      formattedBudgeted: "€90,00",
      formattedRemainingOrOver: "€18,00",
    },
    {
      budgetName: "Casa",
      categoryName: "Refeições fora",
      state: "near",
      threshold: 80,
      formattedPercentageUsed: "83%",
      formattedSpent: "€82,50",
      formattedBudgeted: "€100,00",
      formattedRemainingOrOver: "€17,50",
    },
  ],
  ctaUrl: "https://app.wonder.money/pt/budgets",
  settingsUrl: "https://app.wonder.money/pt/settings?tab=notifications",
  privacyUrl: "https://docs.wonder.money/pt/about/privacy-policy",
  unsubscribeUrl: "https://app.wonder.money/pt/email/unsubscribe/EXEMPLO",
} satisfies BudgetThresholdAlertProps;

export default BudgetThresholdAlertPreview;

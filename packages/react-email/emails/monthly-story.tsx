import MonthlyStory, {
  type MonthlyStoryProps,
} from "../src/templates/monthly-story";

export * from "../src/templates/monthly-story";

function MonthlyStoryPreview(props: MonthlyStoryProps) {
  return <MonthlyStory {...props} />;
}

MonthlyStoryPreview.PreviewProps = {
  status: "sufficient",
  firstName: "Marta",
  monthLabel: "julho de 2026",
  narrativeSentences: [
    "Julho ficou 420 € mais caro do que o habitual.",
    "Viagens e restaurantes explicam a maior parte do aumento.",
    "A tua taxa de poupança desceu de 28% para 19%.",
  ],
  formattedIncomeBaseline: "2.400 €",
  formattedIncomeSubject: "2.400 €",
  formattedSpendingBaseline: "1.680 €",
  formattedSpendingSubject: "2.100 €",
  categoryDeltas: [
    { categoryName: "Viagens", direction: "increase", formattedBaselineAmount: "80 €", formattedSubjectAmount: "310 €", formattedDelta: "+230 €" },
    { categoryName: "Restaurantes", direction: "increase", formattedBaselineAmount: "140 €", formattedSubjectAmount: "260 €", formattedDelta: "+120 €" },
  ],
  recurringChanges: [
    { displayName: "Netflix", kind: "changed", formattedPreviousAmount: "12,99 €", formattedNewAmount: "14,99 €" },
    { displayName: "Ginásio Fit24", kind: "new", formattedNewAmount: "39,90 €" },
  ],
  budgetPressureStatus: "Perto do definido",
  budgetPressureDetail: "2 categorias perto do valor definido",
  savingsRateMetric: { label: "Taxa de poupança", formattedValue: "19%", formattedBaseline: "28%", tone: "negative" },
  netWorthMetric: { label: "Património", formattedValue: "+1.240 €", tone: "positive" },
  language: "pt",
  ctaUrl: "https://app.wonder.money/pt/reports",
  settingsUrl: "https://app.wonder.money/pt/settings?tab=notifications",
  privacyUrl: "https://docs.wonder.money/pt/about/privacy-policy",
  unsubscribeUrl: "https://app.wonder.money/pt/email/unsubscribe/EXEMPLO",
} satisfies MonthlyStoryProps;

export default MonthlyStoryPreview;

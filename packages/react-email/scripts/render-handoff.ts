import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { render } from "@react-email/render";
import { createElement, type ReactElement } from "react";

import BudgetThresholdAlert, {
  getBudgetThresholdPreheader,
  getBudgetThresholdSubject,
} from "../emails/budget-threshold-alert";
import MonthlyStory from "../emails/monthly-story";
import RecoveryBankConnection from "../emails/recovery-bank-connection";
import RetentionRenewBankConnection from "../emails/retention-renew-bank-connection";
import RetentionWeeklyOverview from "../emails/retention-weekly-overview";
import WeeklyInsights from "../emails/weekly-insights";

const isCheck = process.argv.includes("--check");
const outputDirectory = resolve(process.cwd(), "out");
const templates: Array<{
  name: string;
  element: () => ReactElement;
  campaign: string;
  content: string;
  expectedNext: string;
}> = [
  {
    name: "retention-weekly-overview",
    element: () => createElement(RetentionWeeklyOverview, {
      firstName: "Marta",
      netWorth: "€42.860,20",
      netWorthChange: "+€315,40",
      weeklySpending: "€286,70",
      topCategory: "Supermercado",
      budgetStatus: "62% utilizado",
      portfolioChange: "+1,8%",
    }),
    campaign: "retention_weekly_overview",
    content: "active_weekly_digest",
    expectedNext: "next=%2Fpt",
  },
  {
    name: "retention-renew-bank-connection",
    element: () => createElement(RetentionRenewBankConnection, {
      firstName: "Marta",
      bankName: "Banco Exemplo",
      expiryDate: "24 jul 2026",
    }),
    campaign: "retention_renew_bank_connection",
    content: "bank_authorization_renewal",
    expectedNext: "next=%2Fpt%2Faccounts",
  },
  {
    name: "recovery-bank-connection",
    element: () => createElement(RecoveryBankConnection, {
      firstName: "Marta",
      bankName: "Banco Exemplo",
    }),
    campaign: "recovery_bank_connection",
    content: "incomplete_bank_connection",
    expectedNext: "next=%2Fpt%2Faccounts",
  },


  {
    name: "budget-threshold-alert",
    element: () => createElement(BudgetThresholdAlert, {
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
    }),
    campaign: "budget_threshold_alert",
    content: "daily_aggregated_thresholds",
    expectedNext: "next=%2Fpt%2Fbudgets",
  },
  {
    name: "weekly-insights",
    element: () => createElement(WeeklyInsights, {
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
    }),
    campaign: "weekly_insights",
    content: "completed_lisbon_week",
    expectedNext: "next=%2Fpt",
  },
  {
    name: "monthly-story",
    element: () => createElement(MonthlyStory, {
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
    }),
    campaign: "monthly_story",
    content: "monthly_story",
    expectedNext: "next=%2Fpt%2Freports",
  },

];

const budgetCopyCases = [
  {
    items: [{ state: "over" as const }, { state: "at_limit" as const }],
    subject: "Há categorias acima do valor planeado",
    preheader: "Algumas categorias estão acima do valor planeado para este mês.",
  },
  {
    items: [{ state: "at_limit" as const }, { state: "near" as const }],
    subject: "Há categorias que atingiram o valor definido",
    preheader: "Algumas categorias atingiram o valor definido para este mês.",
  },
  {
    items: [{ state: "near" as const }],
    subject: "Há categorias perto do valor definido",
    preheader: "Algumas categorias estão perto do valor definido para este mês.",
  },
];

for (const copyCase of budgetCopyCases) {
  if (getBudgetThresholdSubject(copyCase.items) !== copyCase.subject) {
    throw new Error("budget-threshold-alert: subject adaptativo incorreto");
  }
  if (getBudgetThresholdPreheader(copyCase.items) !== copyCase.preheader) {
    throw new Error("budget-threshold-alert: preheader adaptativo incorreto");
  }
}

if (!isCheck) {
  await mkdir(outputDirectory, { recursive: true });
}

for (const template of templates) {
  const element = template.element();
  const [html, text] = await Promise.all([
    render(element, { pretty: true }),
    render(element, { plainText: true }),
  ]);

  if (!html.includes(template.expectedNext)) {
    throw new Error(`${template.name}: o parâmetro next não foi preservado`);
  }
  const expectedUtmSource = "mailjet";
  if (!html.includes(`utm_source=${expectedUtmSource}`) || !html.includes("utm_medium=email")) {
    throw new Error(`${template.name}: tracking base em falta`);
  }
  if (!html.includes(`utm_campaign=${template.campaign}`)) {
    throw new Error(`${template.name}: campanha UTM incorreta`);
  }
  if (!html.includes(`utm_content=${template.content}`)) {
    throw new Error(`${template.name}: conteúdo UTM incorreto`);
  }
  if (!text.trim()) {
    throw new Error(`${template.name}: o output plain-text está vazio`);
  }

  if (template.name === "budget-threshold-alert") {
    if (!html.includes("Refeições fora")) {
      throw new Error("budget-threshold-alert: nem todos os cruzamentos foram renderizados");
    }
    if (html.includes("no resumo completo")) {
      throw new Error("budget-threshold-alert: encontrou truncamento de categorias");
    }
  }

  if (
    template.name.startsWith("portfolio-launch-") &&
    !html.includes("next=%2Fpt%2Fportfolio")
  ) {
    throw new Error(`${template.name}: validação dedicada de Portefólios falhou`);
  }

  if (!isCheck) {
    await Promise.all([
      writeFile(resolve(outputDirectory, `${template.name}.html`), html),
      writeFile(resolve(outputDirectory, `${template.name}.txt`), text),
    ]);
  }
}

console.log(
  isCheck
    ? "Render e tracking verificados para os doze templates."
    : `HTML e TXT exportados para ${outputDirectory}`,
);

import assert from "node:assert/strict";

import {
  getWeeklyInsightsPreheader,
  renderAccountConnectedEmail,
  renderBudgetThresholdAlert,
  renderInternalAlertEmail,
  renderLifecycleNudgeEmail,
  renderMonthlyStory,
  renderWeeklyInsights,
  type BudgetThresholdAlertProps,
  type BudgetThresholdItem,
  type MonthlyStoryDataSufficientProps,
  type MonthlyStoryInsufficientDataProps,
  type WeeklyInsightsProps,
} from "../src/index";

const urls = {
  ctaUrl: "https://app.wonder.money/pt/budgets?source=custom",
  settingsUrl: "https://app.wonder.money/pt/settings?tab=notifications",
  privacyUrl: "https://docs.wonder.money/pt/about/privacy-policy",
  unsubscribeUrl: "https://app.wonder.money/pt/email/unsubscribe/CUSTOM_TOKEN",
};

function budgetItem(state: BudgetThresholdItem["state"]): BudgetThresholdItem {
  const common = {
    budgetName: "Orçamento de teste único",
    categoryName: "Categoria de teste única",
    formattedPercentageUsed: state === "near" ? "81%" : state === "at_limit" ? "100%" : "108%",
    formattedSpent: "€81,23",
    formattedBudgeted: "€100,00",
    formattedRemainingOrOver: "€18,77",
  };

  return state === "near"
    ? { ...common, state, threshold: 80 }
    : { ...common, state, threshold: 100 };
}

function budgetProps(items: BudgetThresholdItem[]): BudgetThresholdAlertProps {
  return {
    firstName: "NomeCustomExclusivo",
    periodLabel: "período customizado exclusivo",
    items,
    ...urls,
  };
}

const subjectCases = [
  ["over", "Há categorias acima do valor planeado"],
  ["at_limit", "Há categorias que atingiram o valor definido"],
  ["near", "Há categorias perto do valor definido"],
] as const;

for (const [state, expectedSubject] of subjectCases) {
  const rendered = await renderBudgetThresholdAlert(budgetProps([budgetItem(state)]));
  assert.equal(rendered.subject, expectedSubject);
  assert.ok(rendered.preheader.trim());
  assert.ok(rendered.html.trim());
  assert.ok(rendered.text.trim());
}

const budgetRendered = await renderBudgetThresholdAlert(budgetProps([budgetItem("over")]));
assert.match(budgetRendered.html, /utm_source=mailjet/);
assert.match(budgetRendered.html, /next=%2Fpt%2Fbudgets/);
for (const url of [urls.settingsUrl, urls.privacyUrl, urls.unsubscribeUrl]) {
  assert.ok(budgetRendered.html.includes(url.replaceAll("&", "&amp;")));
}

const allCrossings = [
  budgetItem("near"),
  { ...budgetItem("near"), categoryName: "Quarta categoria reservada" },
  budgetItem("at_limit"),
  budgetItem("over"),
];
const allCrossingsRendered = await renderBudgetThresholdAlert(budgetProps(allCrossings));
for (const item of allCrossings) {
  assert.ok(allCrossingsRendered.html.includes(item.categoryName));
}
assert.ok(!allCrossingsRendered.html.includes("no resumo completo"));
for (const previewValue of ["Marta", "Supermercado", "julho de 2026", "EXEMPLO"]) {
  assert.ok(!budgetRendered.html.includes(previewValue), `preview value leaked: ${previewValue}`);
  assert.ok(!budgetRendered.text.includes(previewValue), `preview value leaked in text: ${previewValue}`);
}

const weeklyProps: WeeklyInsightsProps = {
  firstName: "NomeSemanalCustomExclusivo",
  weekDateRange: "intervalo semanal customizado",
  formattedTotalSpending: "€12,34",
  topCategoryDisplay: "Grupo único · Categoria única",
  formattedTopCategoryAmount: "€9,87",
  dataContext: "Contexto de dados customizado e exclusivo.",
  ...urls,
  ctaUrl: "https://app.wonder.money/pt",
};
const weeklyRendered = await renderWeeklyInsights(weeklyProps);
assert.ok(weeklyRendered.subject.trim());
assert.ok(weeklyRendered.preheader.trim());
assert.ok(weeklyRendered.html.trim());
assert.ok(weeklyRendered.text.trim());
assert.match(weeklyRendered.html, /next=%2Fpt/);
assert.equal(
  weeklyRendered.preheader,
  "Gastos e categoria principal da semana completa.",
);
assert.equal(weeklyRendered.preheader, getWeeklyInsightsPreheader(undefined));
const weeklyWithBudget = await renderWeeklyInsights({
  ...weeklyProps,
  budgetSummary: { status: "near", nearCount: 1 },
});
assert.equal(
  weeklyWithBudget.preheader,
  "Gastos, categoria principal e estado dos orçamentos da semana completa.",
);
assert.equal(
  weeklyWithBudget.preheader,
  getWeeklyInsightsPreheader({ status: "near" }),
);
for (const url of [weeklyProps.settingsUrl, weeklyProps.privacyUrl, weeklyProps.unsubscribeUrl]) {
  assert.ok(weeklyRendered.html.includes(url.replaceAll("&", "&amp;")));
}
for (const previewValue of ["Marta", "€436,80", "6 a 12 de julho de 2026", "EXEMPLO"]) {
  assert.ok(!weeklyRendered.html.includes(previewValue), `weekly preview value leaked: ${previewValue}`);
  assert.ok(!weeklyRendered.text.includes(previewValue), `weekly preview value leaked in text: ${previewValue}`);
}

const monthlyStoryUrls = {
  ctaUrl: "https://app.wonder.money/pt/reports",
  settingsUrl: "https://app.wonder.money/pt/settings?tab=notifications",
  privacyUrl: "https://docs.wonder.money/pt/about/privacy-policy",
  unsubscribeUrl: "https://app.wonder.money/pt/email/unsubscribe/CUSTOM_TOKEN",
};

const monthlyStorySufficientProps: MonthlyStoryDataSufficientProps = {
  status: "sufficient",
  language: "pt",
  firstName: "NomeMensalCustomExclusivo",
  monthLabel: "mês customizado exclusivo",
  narrativeSentences: ["Frase narrativa mensal customizada exclusiva."],
  // pt-PT formatting: '.' is the thousands separator, ',' is the decimal — one
  // value under €1000 and one at/above €1000, to catch locale-blind parsing.
  formattedIncomeBaseline: "1.200,00 €",
  formattedIncomeSubject: "800,00 €",
  formattedSpendingBaseline: "600,00 €",
  formattedSpendingSubject: "900,00 €",
  categoryDeltas: [
    { categoryName: "Categoria mensal exclusiva", direction: "increase", formattedBaselineAmount: "80,00 €", formattedSubjectAmount: "310,00 €", formattedDelta: "+230,00 €" },
  ],
  recurringChanges: [
    { displayName: "Serviço mensal exclusivo", kind: "changed", formattedPreviousAmount: "12,99 €", formattedNewAmount: "14,99 €" },
  ],
  budgetPressureStatus: "Perto do definido",
  budgetPressureDetail: "detalhe de pressão customizado exclusivo",
  savingsRateMetric: { label: "Taxa de poupança", formattedValue: "19%", formattedBaseline: "28%", tone: "negative" },
  netWorthMetric: { label: "Património", formattedValue: "+1.240 €", tone: "positive" },
  ...monthlyStoryUrls,
};

const monthlyStoryRendered = await renderMonthlyStory(monthlyStorySufficientProps);
assert.ok(monthlyStoryRendered.subject.trim());
assert.ok(monthlyStoryRendered.preheader.trim());
assert.ok(monthlyStoryRendered.html.trim());
assert.ok(monthlyStoryRendered.text.trim());
assert.match(monthlyStoryRendered.html, /utm_source=mailjet/);
assert.match(monthlyStoryRendered.html, /next=%2Fpt%2Freports/);
assert.ok(
  monthlyStoryRendered.html.includes(monthlyStorySufficientProps.budgetPressureDetail as string),
  "monthly-story budget pressure detail missing",
);
for (const url of [monthlyStoryUrls.settingsUrl, monthlyStoryUrls.privacyUrl, monthlyStoryUrls.unsubscribeUrl]) {
  assert.ok(monthlyStoryRendered.html.includes(url.replaceAll("&", "&amp;")));
}

// Regression (final review, RAD-164): pt-PT uses '.' as the thousands separator
// and ',' as the decimal separator (e.g. formatMoney renders "1.200,00 €"). A
// locale-blind digit strip previously mis-parsed that as 1.2, zeroing/inverting
// the comparison-bar widths whenever one side of the bar crossed €1000. Assert
// the actual rendered bar widths are proportional to the real amounts — baseline
// (1.200,00 €) must be the full bar (100%) and subject (800,00 €) must be ~67%
// (800 / 1200), never the reverse.
function comparisonBarWidths(html: string, backgroundColor: string): number[] {
  return [...html.matchAll(new RegExp(`width="(\\d+)%" style="background-color:${backgroundColor}[^"]*"`, "g"))].map((match) => Number(match[1]));
}

const ptIncomeBaselineWidths = comparisonBarWidths(monthlyStoryRendered.html, "#ede9fe");
const ptIncomeSubjectWidths = comparisonBarWidths(monthlyStoryRendered.html, "#7c3aed");
assert.equal(ptIncomeBaselineWidths[0], 100, "pt-PT income baseline bar width should be 100% (it is the larger value)");
assert.equal(ptIncomeSubjectWidths[0], 67, "pt-PT income subject bar width should be ~67% (800/1200), not inverted or zeroed");

// Same check in English formatting (comma thousands, dot decimal) to confirm the
// locale-aware fix didn't regress the language that already parsed correctly.
const monthlyStoryEnRendered = await renderMonthlyStory({
  ...monthlyStorySufficientProps,
  language: "en",
  formattedIncomeBaseline: "$1,200.00",
  formattedIncomeSubject: "$800.00",
});
const enIncomeBaselineWidths = comparisonBarWidths(monthlyStoryEnRendered.html, "#ede9fe");
const enIncomeSubjectWidths = comparisonBarWidths(monthlyStoryEnRendered.html, "#7c3aed");
assert.equal(enIncomeBaselineWidths[0], 100, "en income baseline bar width should be 100%");
assert.equal(enIncomeSubjectWidths[0], 67, "en income subject bar width should be ~67% (800/1200)");

const monthlyStoryInsufficientProps: MonthlyStoryInsufficientDataProps = {
  status: "insufficient",
  language: "pt",
  firstName: "NomeMensalCustomExclusivo",
  monthLabel: "mês customizado exclusivo",
  monthsAvailable: 1,
  monthsNeeded: 2,
  reason: "insufficient_history",
  ...monthlyStoryUrls,
};
const monthlyStoryInsufficientRendered = await renderMonthlyStory(monthlyStoryInsufficientProps);
assert.ok(monthlyStoryInsufficientRendered.subject.trim());
assert.ok(monthlyStoryInsufficientRendered.html.trim());
assert.ok(monthlyStoryInsufficientRendered.text.trim());
assert.match(monthlyStoryInsufficientRendered.preheader, /2/);

const monthlyStoryZeroActivityRendered = await renderMonthlyStory({
  ...monthlyStoryInsufficientProps,
  reason: "zero_activity",
  formattedIncomeSubject: "0,00 €",
});
assert.ok(monthlyStoryZeroActivityRendered.html.includes("0,00"), "monthly-story zero-activity metrics panel missing");

for (const previewValue of ["Marta", "julho de 2026", "EXEMPLO"]) {
  assert.ok(!monthlyStoryRendered.html.includes(previewValue), `monthly-story preview value leaked: ${previewValue}`);
  assert.ok(!monthlyStoryRendered.text.includes(previewValue), `monthly-story preview value leaked in text: ${previewValue}`);
}

await assert.rejects(
  renderBudgetThresholdAlert(budgetProps([])),
  /at least one budget threshold item/,
);

for (const invalidUrl of ["/pt/budgets", "ftp://app.wonder.money/pt/budgets", "javascript:alert(1)"]) {
  for (const field of ["ctaUrl", "settingsUrl", "privacyUrl", "unsubscribeUrl"] as const) {
    await assert.rejects(
      renderBudgetThresholdAlert({ ...budgetProps([budgetItem("near")]), [field]: invalidUrl }),
      new RegExp(`${field} must be an absolute http\\(s\\) URL`),
    );
    await assert.rejects(
      renderWeeklyInsights({ ...weeklyProps, [field]: invalidUrl }),
      new RegExp(`${field} must be an absolute http\\(s\\) URL`),
    );
    await assert.rejects(
      renderMonthlyStory({ ...monthlyStorySufficientProps, [field]: invalidUrl }),
      new RegExp(`${field} must be an absolute http\\(s\\) URL`),
    );
  }
}

// Internal alert (team inbox): echoes the caller subject, renders detail rows, no tracking.
const alert = await renderInternalAlertEmail({
  subject: "Wonder.money - INTERNAL Household invite blocked",
  variant: "warning",
  title: "Household invite blocked",
  intro: "An invite was accepted by an email that already has an account.",
  details: [
    { label: "User", value: "user@example.com" },
    { label: "Household", value: "HH-123" },
    { label: "Invite", value: "inv_1ABCdef" },
  ],
});
assert.equal(alert.subject, "Wonder.money - INTERNAL Household invite blocked");
assert.ok(alert.preheader.trim());
assert.ok(alert.html.includes("Household invite blocked"), "alert title missing");
assert.ok(alert.html.includes("user@example.com") && alert.html.includes("inv_1ABCdef"), "alert details missing");
assert.ok(alert.text.includes("HH-123"), "alert details missing from text");
assert.ok(!/utm_|unsubscribe/i.test(alert.html), "internal alert must not carry marketing/unsubscribe");
// Minimal (no details/intro) still renders.
const bareAlert = await renderInternalAlertEmail({ subject: "Wonder.money - Support", title: "New support message" });
assert.ok(bareAlert.html.includes("New support message") && bareAlert.text.trim());

// Lifecycle nudge (bank recovery): EN/PT, multi-paragraph body, unsubscribe footer.
const nudgeUnsub = "https://api.wonder.money/v1/marketing/email-opt-out?token=NUDGE";
for (const [language, expectedGreeting] of [["en", "Hi Ada,"], ["pt", "Olá Ada,"]] as const) {
  const nudge = await renderLifecycleNudgeEmail({
    language,
    subject: "Your bank connection needs another try",
    firstName: "Ada",
    heading: "Let's finish connecting your bank",
    body: ["Your bank connection didn't finish, so your accounts may be out of date.", "Reopen WonderMoney and retry — it only takes a moment."],
    ctaLabel: "Retry the connection",
    ctaUrl: "https://app.wonder.money/en/accounts",
    unsubscribeUrl: nudgeUnsub,
    settingsUrl: "https://app.wonder.money/en/settings?tab=notifications",
  });
  assert.equal(nudge.subject, "Your bank connection needs another try");
  assert.ok(nudge.html.includes(expectedGreeting), `nudge greeting missing for ${language}`);
  assert.ok(nudge.html.includes("retry") || nudge.html.includes("Reopen"), "nudge body missing");
  assert.ok(nudge.html.includes(nudgeUnsub) && nudge.html.includes("app.wonder.money/en/accounts"), `nudge links missing for ${language}`);
  assert.ok(!/utm_/i.test(nudge.html), "nudge must not carry campaign tracking");
}
await assert.rejects(
  renderLifecycleNudgeEmail({ language: "en", subject: "x", heading: "x", body: ["y"], unsubscribeUrl: "javascript:alert(1)" }),
  /unsubscribeUrl must be an absolute http\(s\) URL/,
);
await assert.rejects(
  renderLifecycleNudgeEmail({ language: "en", subject: "x", heading: "x", body: [], unsubscribeUrl: nudgeUnsub }),
  /body must contain at least one paragraph/,
);

// Account connected ("new bank"): subject/body carry the bank name, CTA to accounts, no tracking.
for (const language of ["en", "pt"] as const) {
  const connected = await renderAccountConnectedEmail({
    language, firstName: "Ada", bankName: "Millennium BCP",
    dashboardUrl: "https://app.wonder.money/en/accounts",
  });
  assert.ok(connected.subject.includes("Millennium BCP"), `account-connected subject missing bank for ${language}`);
  assert.ok(connected.html.includes("Millennium BCP"), `account-connected body missing bank for ${language}`);
  assert.ok(connected.html.includes("app.wonder.money/en/accounts"), `account-connected CTA missing for ${language}`);
  assert.ok(!/utm_|unsubscribe/i.test(connected.html), "account-connected must not carry marketing/unsubscribe");
}
await assert.rejects(
  renderAccountConnectedEmail({ language: "en", bankName: "X", dashboardUrl: "javascript:alert(1)" }),
  /dashboardUrl must be an absolute http\(s\) URL/,
);

// A self-hosted instance on a LAN address sends plain-http links.
const lanConnected = await renderAccountConnectedEmail({ language: "en", bankName: "X", dashboardUrl: "http://192.168.1.10:3000/en/accounts" });
assert.ok(lanConnected.html.includes("http://192.168.1.10:3000/en/accounts"), "http link must render");

console.log("Production library renderers verified.");

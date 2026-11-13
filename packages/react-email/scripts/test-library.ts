import assert from "node:assert/strict";

import {
  getWeeklyInsightsPreheader,
  renderAccountConnectedEmail,
  renderBankSyncAlertEmail,
  renderBudgetThresholdAlert,
  renderCreditCardDueReminderEmail,
  renderEmailVerificationEmail,
  renderHouseholdInviteEmail,
  renderInternalAlertEmail,
  renderLifecycleNudgeEmail,
  renderMonthlyStory,
  renderPasswordResetEmail,
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

// pt-PT uses '.' as the thousands separator and ',' as the decimal separator
// (e.g. formatMoney renders "1.200,00 €"). A locale-blind digit strip would
// mis-parse that as 1.2, zeroing/inverting the comparison-bar widths whenever
// one side of the bar crosses €1000. Assert
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

// Lifecycle nudge (bank recovery): EN/PT/ES, multi-paragraph body, unsubscribe footer.
const nudgeUnsub = "https://api.wonder.money/v1/marketing/email-opt-out?token=NUDGE";
for (const [language, expectedGreeting] of [["en", "Hi Ada,"], ["pt", "Olá Ada,"], ["es", "Hola Ada,"]] as const) {
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
for (const language of ["en", "pt", "es"] as const) {
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

// Bank sync alerts: every kind renders in every language with the bank, its date and both links.
{
  const kinds = ["consent_expiring_7d", "consent_expiring_1d", "consent_revoked", "sync_failing"] as const;
  const subjects = new Set<string>();
  for (const language of ["en", "pt", "es"] as const) {
    for (const kind of kinds) {
      const alert = await renderBankSyncAlertEmail({
        language, firstName: "Ada", kind, bankName: "Banco Exemplo",
        expiryDate: "14 November", failingSinceDate: "2 November",
        reconnectUrl: "https://app.wonder.money/en/settings?tab=connections",
        settingsUrl: "https://app.wonder.money/en/settings?tab=notifications",
      });
      assert.ok(alert.subject.includes("Banco Exemplo"), `bank-sync-alert ${kind} subject missing bank for ${language}`);
      assert.ok(alert.text.includes("Banco Exemplo"), `bank-sync-alert ${kind} body missing bank for ${language}`);
      assert.ok(alert.html.includes("tab=connections"), `bank-sync-alert ${kind} reconnect link missing for ${language}`);
      assert.ok(alert.html.includes("tab=notifications"), `bank-sync-alert ${kind} settings link missing for ${language}`);
      if (kind.startsWith("consent_expiring")) assert.ok(alert.text.includes("14 November"), `bank-sync-alert ${kind} missing expiry date`);
      if (kind === "sync_failing") assert.ok(alert.text.includes("2 November"), "bank-sync-alert sync_failing missing failing-since date");
      assert.ok(!/utm_/i.test(alert.html), "bank-sync-alert must not carry campaign tracking");
      subjects.add(alert.subject);
    }
  }
  const spanish = await renderCreditCardDueReminderEmail({
    language: "es", accountName: "Tarjeta", amountDue: "428,30 €",
    periodLabel: "1–31 de octubre", dueDate: "25 de noviembre", daysUntilDue: 3,
    statementUrl: "https://a.test/statements", settingsUrl: "https://a.test/settings",
  });
  assert.ok(spanish.text.includes("extracto"), "credit-card-due-reminder must render Spanish copy");
  assert.equal(subjects.size, kinds.length * 3, "each bank-sync-alert kind and language needs its own subject");
  await assert.rejects(
    renderBankSyncAlertEmail({ language: "en", kind: "consent_revoked", bankName: "X", reconnectUrl: "javascript:alert(1)", settingsUrl: "https://app.wonder.money/en/settings" }),
    /reconnectUrl must be an absolute http\(s\) URL/,
  );
  await assert.rejects(
    renderBankSyncAlertEmail({ language: "en", kind: "consent_expiring_7d", bankName: "X", reconnectUrl: "https://a.test/", settingsUrl: "https://a.test/" }),
    /expiryDate is required/,
  );
  await assert.rejects(
    renderBankSyncAlertEmail({ language: "en", kind: "sync_failing", bankName: "X", reconnectUrl: "https://a.test/", settingsUrl: "https://a.test/" }),
    /failingSinceDate is required/,
  );
}

// A credit-card payment reminder: the account, the amount and the due date reach both languages,
// the CTA opens the statements, and no campaign tracking rides along.
{
  for (const language of ["en", "pt", "es"] as const) {
    const reminder = await renderCreditCardDueReminderEmail({
      language, firstName: "Ada", accountName: "Millennium Card", amountDue: "€428.30",
      periodLabel: "1 – 31 October", dueDate: "25 November", daysUntilDue: 3,
      statementUrl: "https://app.wonder.money/en/accounts/12?tab=statements",
      settingsUrl: "https://app.wonder.money/en/settings?tab=notifications",
    });
    assert.ok(reminder.subject.includes("Millennium Card"), `credit-card-due-reminder subject missing account for ${language}`);
    assert.ok(reminder.text.includes("€428.30"), `credit-card-due-reminder body missing amount for ${language}`);
    assert.ok(reminder.text.includes("25 November"), `credit-card-due-reminder body missing due date for ${language}`);
    assert.ok(reminder.html.includes("tab=statements"), `credit-card-due-reminder statement link missing for ${language}`);
    assert.ok(reminder.html.includes("tab=notifications"), `credit-card-due-reminder settings link missing for ${language}`);
    assert.ok(!/utm_/i.test(reminder.html), "credit-card-due-reminder must not carry campaign tracking");
  }
  const tomorrow = await renderCreditCardDueReminderEmail({
    language: "en", accountName: "Millennium Card", amountDue: "€10.00",
    periodLabel: "1 – 31 October", dueDate: "12 November", daysUntilDue: 1,
    statementUrl: "https://a.test/statements", settingsUrl: "https://a.test/settings",
  });
  assert.ok(/tomorrow/i.test(tomorrow.subject), "a reminder due in one day must read as tomorrow");
  for (const [language, word] of [["en", /today/i], ["pt", /hoje/i], ["es", /hoy/i]] as const) {
    const today = await renderCreditCardDueReminderEmail({
      language, accountName: "Millennium Card", amountDue: "€10.00",
      periodLabel: "1 – 31 October", dueDate: "12 November", daysUntilDue: 0,
      statementUrl: "https://a.test/statements", settingsUrl: "https://a.test/settings",
    });
    assert.ok(word.test(today.subject), `a reminder due today must say so in ${language}`);
  }
  await assert.rejects(
    renderCreditCardDueReminderEmail({
      language: "en", accountName: "X", amountDue: "€1.00", periodLabel: "p", dueDate: "d", daysUntilDue: 3,
      statementUrl: "javascript:alert(1)", settingsUrl: "https://a.test/",
    }),
    /statementUrl must be an absolute http\(s\) URL/,
  );
}

// Account emails (password reset, email verification, household invite): each language has its own
// subject and copy, the action link is both the button and written out, and nothing tracks or
// offers an unsubscribe. A name with markup in it arrives as text.
{
  const resetUrl = "https://api.example.test/api/auth/reset-password/T0K3N?callbackURL=https%3A%2F%2Fapp.example.test%2Fes%2Fauth%2Freset";
  const verificationUrl = "https://api.example.test/api/auth/verify-email?token=T0K3N&callbackURL=https%3A%2F%2Fapp.example.test%2Fes";
  const acceptUrl = "https://app.example.test/es/join?token=T0K3N";
  const words = { en: /password/i, pt: /palavra-passe/i, es: /contraseña/i } as const;
  const subjects = new Set<string>();
  for (const language of ["en", "pt", "es"] as const) {
    const reset = await renderPasswordResetEmail({ language, firstName: "Ada", resetUrl });
    const verification = await renderEmailVerificationEmail({ language, firstName: "Ada", verificationUrl });
    const invite = await renderHouseholdInviteEmail({ language, inviterName: "Ada", acceptUrl, expiresInDays: 7 });
    assert.ok(words[language].test(reset.subject), `password-reset subject must be in ${language}`);
    assert.ok(invite.subject.includes("Ada"), `household-invite subject must name the inviter in ${language}`);
    assert.ok(invite.text.includes("7"), `household-invite must state the expiry in ${language}`);
    assert.ok(new RegExp(`<html[^>]*lang="${language}"`).test(reset.html), `password-reset must declare ${language}`);
    for (const [name, email, url] of [["password-reset", reset, resetUrl], ["email-verification", verification, verificationUrl], ["household-invite", invite, acceptUrl]] as const) {
      const href = url.replaceAll("&", "&amp;");
      assert.ok(email.html.split(`href="${href}"`).length - 1 >= 2, `${name} must link the button and the written-out link in ${language}`);
      assert.ok(email.text.includes(url), `${name} plain text must carry the link in ${language}`);
      assert.ok(!/utm_|unsubscribe/i.test(email.html), `${name} must not carry tracking or an unsubscribe`);
      subjects.add(email.subject);
    }
  }
  assert.equal(subjects.size, 9, "each account email and language needs its own subject");

  const marked = await renderHouseholdInviteEmail({ language: "en", inviterName: '<a href="https://evil.test">Ada</a>', acceptUrl, expiresInDays: 7 });
  assert.ok(!marked.html.includes('<a href="https://evil.test">'), "an inviter name must not become markup");
  for (const render of [
    () => renderPasswordResetEmail({ language: "en", resetUrl: "javascript:alert(1)" }),
    () => renderEmailVerificationEmail({ language: "en", verificationUrl: "/verify" }),
    () => renderHouseholdInviteEmail({ language: "en", inviterName: "Ada", acceptUrl: "data:text/html,x", expiresInDays: 7 }),
  ]) {
    await assert.rejects(render(), /must be an absolute http\(s\) URL/);
  }
}

// A self-hosted instance on a LAN address sends plain-http links.
const lanConnected = await renderAccountConnectedEmail({ language: "en", bankName: "X", dashboardUrl: "http://192.168.1.10:3000/en/accounts" });
assert.ok(lanConnected.html.includes("http://192.168.1.10:3000/en/accounts"), "http link must render");

// A self-hosted instance's emails carry its own name, not WonderMoney's logo, name or legal entity.
{
  const brandName = "Casa Finance";
  const lan = {
    ctaUrl: "http://192.168.1.10:3000/en",
    settingsUrl: "http://192.168.1.10:3000/en/settings",
    privacyUrl: "http://192.168.1.10:3000/privacy",
    unsubscribeUrl: "http://192.168.1.10:3000/en/email/unsubscribe/T",
  };
  const selfHosted = [
    await renderAccountConnectedEmail({ language: "en", bankName: "X", dashboardUrl: "http://192.168.1.10:3000/en/accounts", brandName }),
    await renderAccountConnectedEmail({ language: "pt", bankName: "X", dashboardUrl: "http://192.168.1.10:3000/pt/accounts", brandName }),
    await renderBudgetThresholdAlert({ ...budgetProps([budgetItem("near")]), ...lan, language: "en", brandName }),
    await renderLifecycleNudgeEmail({ language: "en", subject: "s", heading: "h", body: ["b"], unsubscribeUrl: lan.unsubscribeUrl, brandName }),
    await renderBankSyncAlertEmail({ language: "en", kind: "consent_revoked", bankName: "X", reconnectUrl: lan.ctaUrl, settingsUrl: lan.settingsUrl, brandName }),
  ];
  for (const email of selfHosted) {
    assert.ok(email.text.includes(brandName), "self-hosted email must name the instance");
    assert.ok(!/Wonder\.?money|Radix Catch/i.test(email.text), "self-hosted email must not carry the hosted brand");
    assert.ok(!email.html.includes("app.wonder.money/logo.png"), "self-hosted email must not load the hosted logo");
  }
  assert.ok(selfHosted[0].subject.includes(brandName), "account-connected subject must name the instance");

  // Unset or blank, the hosted brand stays.
  const hosted = await renderAccountConnectedEmail({ language: "en", bankName: "X", dashboardUrl: "https://app.wonder.money/en/accounts", brandName: " " });
  assert.ok(hosted.subject.includes("WonderMoney"));
  assert.ok(hosted.html.includes("app.wonder.money/logo.png") && hosted.text.includes("Radix Catch"));
}

// Spanish: every template reads Spanish, with es-formatted values and /es links.
{
  const esUrls = {
    ctaUrl: "https://app.wonder.money/es/budgets",
    settingsUrl: "https://app.wonder.money/es/settings?tab=notifications",
    privacyUrl: "https://docs.wonder.money/es/about/privacy-policy",
    unsubscribeUrl: "https://app.wonder.money/es/email/unsubscribe/CUSTOM_TOKEN",
  };
  const esItem = { ...budgetItem("over"), formattedSpent: "108,00 €", formattedBudgeted: "100,00 €", formattedRemainingOrOver: "8,00 €" };
  const budget = await renderBudgetThresholdAlert({ ...budgetProps([esItem]), ...esUrls, language: "es", firstName: "Lucía", periodLabel: "julio de 2026" });
  assert.equal(budget.subject, "Hay categorías por encima de lo planificado");
  assert.equal(budget.preheader, "Algunas categorías superan el importe planificado para este mes.");
  for (const fragment of ["Hola Lucía,", "Este es el resumen agregado de julio de 2026.", "108,00 € / 100,00 €", "Excedido", "Ver presupuestos", "Ajustes de notificaciones", "Privacidad"]) {
    assert.ok(budget.text.includes(fragment), `Spanish budget alert missing: ${fragment}`);
  }
  assert.match(budget.html, /next=%2Fes%2Fbudgets/);
  assert.ok(budget.html.includes('lang="es"'), "Spanish budget alert must declare lang=es");

  const weekly = await renderWeeklyInsights({ ...weeklyProps, ...esUrls, ctaUrl: "https://app.wonder.money/es", language: "es", weekDateRange: "6 al 12 de julio de 2026", formattedTotalSpending: "90,00 €", budgetSummary: { status: "over", overCount: 2 } });
  assert.equal(weekly.subject, "Tu resumen financiero semanal");
  assert.equal(weekly.preheader, "Gastos, categoría principal y estado de los presupuestos de la semana completa.");
  assert.equal(weekly.preheader, getWeeklyInsightsPreheader({ status: "over" }, "es"));
  for (const fragment of ["Semana completa del 6 al 12 de julio de 2026.", "Gasto total", "90,00 €", "2 por encima de lo planificado", "Ver resumen"]) {
    assert.ok(weekly.text.includes(fragment), `Spanish weekly summary missing: ${fragment}`);
  }
  assert.match(weekly.html, /next=%2Fes(?!%2F)/);

  // es-ES leaves four-digit amounts ungrouped ("1200,00 €"); the bars still compare 1200 to 800.
  const story = await renderMonthlyStory({ ...monthlyStorySufficientProps, ...esUrls, ctaUrl: "https://app.wonder.money/es/reports", language: "es", monthLabel: "julio de 2026", formattedIncomeBaseline: "1200,00 €", formattedIncomeSubject: "800,00 €" });
  assert.equal(story.subject, "Tu resumen financiero del mes: julio de 2026");
  for (const fragment of ["Ingresos vs. lo habitual", "Lo que más cambió", "Pagos recurrentes", "Tasa de ahorro", "antes 28%", "Ver tus informes"]) {
    assert.ok(story.text.includes(fragment), `Spanish monthly story missing: ${fragment}`);
  }
  assert.equal(comparisonBarWidths(story.html, "#ede9fe")[0], 100, "es income baseline bar width should be 100%");
  assert.equal(comparisonBarWidths(story.html, "#7c3aed")[0], 67, "es income subject bar width should be ~67% (800/1200)");
  assert.match(story.html, /next=%2Fes%2Freports/);
  const thin = await renderMonthlyStory({ ...monthlyStoryInsufficientProps, ...esUrls, ctaUrl: "https://app.wonder.money/es/reports", language: "es", monthsNeeded: 1 });
  assert.equal(thin.subject, "Preparando tu resumen financiero");
  assert.match(thin.preheader, /^Necesitamos 1 mes más de historial/);
  const thinner = await renderMonthlyStory({ ...monthlyStoryInsufficientProps, ...esUrls, ctaUrl: "https://app.wonder.money/es/reports", language: "es", monthsNeeded: 2 });
  assert.match(thinner.preheader, /^Necesitamos 2 meses más de historial/);

  const connected = await renderAccountConnectedEmail({ language: "es", firstName: "Lucía", bankName: "Banco Ejemplo", dashboardUrl: "https://app.wonder.money/es/accounts" });
  assert.equal(connected.subject, "Banco Ejemplo está conectado a WonderMoney");
  assert.ok(connected.text.includes("Hola Lucía,") && connected.text.includes("Ver tus cuentas"), "Spanish account-connected copy missing");
  assert.ok(connected.html.includes("app.wonder.money/es/accounts"), "Spanish account-connected link must open /es");

  const sync = await renderBankSyncAlertEmail({
    language: "es", kind: "consent_expiring_7d", bankName: "Banco Ejemplo", expiryDate: "14 de noviembre",
    reconnectUrl: "https://app.wonder.money/es/settings?tab=connections", settingsUrl: "https://app.wonder.money/es/settings?tab=notifications",
  });
  assert.equal(sync.subject, "Tu conexión con Banco Ejemplo termina el 14 de noviembre");
  assert.ok(sync.text.includes("ajustes de notificaciones") && sync.html.includes("/es/settings?tab=connections"), "Spanish bank-sync alert copy or link missing");

  const nudge = await renderLifecycleNudgeEmail({ language: "es", subject: "s", heading: "h", body: ["b"], unsubscribeUrl: nudgeUnsub, settingsUrl: esUrls.settingsUrl });
  for (const fragment of ["Hola,", "Recibes este correo porque tienes una cuenta de WonderMoney.", "Cancelar la suscripción", "Ajustes de notificaciones"]) {
    assert.ok(nudge.text.includes(fragment), `Spanish nudge footer missing: ${fragment}`);
  }
}

console.log("Production library renderers verified.");

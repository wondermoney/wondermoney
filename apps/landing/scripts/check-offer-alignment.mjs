import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const locales = ["en", "pt", "es", "fr", "de", "it"];
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readJson = (path) => JSON.parse(read(path));
const oneFreeMonthPatterns = [
  /(?:1|one|(?:the\s+)?first)\s+month[^\n]{0,60}(?:free|at no cost)|free(?:\s+for)?[^\n]{0,30}(?:1|one|the first)\s+month/i,
  /(?:1|um|(?:o\s+)?primeiro)\s+mês[^\n]{0,60}(?:grátis|gratuito)|(?:grátis|gratuito)[^\n]{0,30}(?:1|um|o primeiro)\s+mês/i,
  /(?:1|un|(?:el\s+)?primer(?:o)?)\s+mes[^\n]{0,60}(?:gratis|gratuito)|(?:gratis|gratuito)[^\n]{0,30}(?:1|un|el primer(?:o)?)\s+mes/i,
  /(?:1|un|(?:le\s+)?premier)\s+mois[^\n]{0,60}gratuit|gratuit[^\n]{0,30}(?:1|un|le premier)\s+mois/i,
  /(?:1|ein(?:en)?|(?:der\s+)?erste[rsn]?)\s+Monat[^\n]{0,60}(?:kostenlos|gratis)|(?:kostenlos|gratis)[^\n]{0,30}(?:1|ein(?:en)?|der erste[rsn]?)\s+Monat/i,
  /(?:1|un|(?:il\s+)?primo)\s+mese[^\n]{0,60}(?:gratis|gratuito)|(?:gratis|gratuito)[^\n]{0,30}(?:1|un|il primo)\s+mese/i,
];
const monthlyAnnualBillingPatterns = [
  /€3\.90\/month[\s\S]{0,160}(?:billed annually|annual billing)/i,
  /€3,90\/mês[\s\S]{0,160}(?:faturad[oa] anualmente|faturação anual)/i,
  /3,90\s*€\/mes[\s\S]{0,160}(?:facturad[oa] anualmente|facturación anual)/i,
  /€3,90\/mois[\s\S]{0,160}(?:facturé[es]? annuellement|facturation annuelle)/i,
  /€3,90\/Monat[\s\S]{0,160}(?:jährlich abgerechnet|Jahresabrechnung)/i,
  /€3,90\/mese[\s\S]{0,160}(?:fatturat[oa] annualmente|fatturazione annuale)/i,
];
const explicitThirtyDayTrialPatterns = [
  /30[- ]day(?:s)?[^\n]*(?:free|trial)|(?:free|trial)[^\n]*30[- ]day(?:s)?/i,
  /30 dias[^\n]*(?:grátis|gratuit|teste)|(?:grátis|gratuit|teste)[^\n]*30 dias/i,
  /30 días[^\n]*(?:gratis|gratuit|prueba)|(?:gratis|gratuit|prueba)[^\n]*30 días/i,
  /30 jours[^\n]*(?:gratuit|essai)|(?:gratuit|essai)[^\n]*30 jours/i,
  /(?:30 Tage|30-täg)[^\n]*(?:kostenlos|Test)|(?:kostenlos|Test)[^\n]*(?:30 Tage|30-täg)/i,
  /30 giorni[^\n]*(?:gratis|gratuit|prova)|(?:gratis|gratuit|prova)[^\n]*30 giorni/i,
];
const anyThirtyDayPattern = /30[- ]days?|30 dias|30 días|30 jours|30 Tage|30-täg|30 giorni/i;
// Retired prices (€4.99/€39.90/€4.15) plus the prices that were live before the
// free/open-source/BYOK pivot (€3.90/€24.90/€99) — all of these are now stale
// public claims anywhere on the marketing site's active surfaces.
const stalePricePattern = /€(?:4[.,]99|39[.,]90|4[.,]15|3[.,]90|24[.,]90)|(?:4,99|39,90|4,15|3,90|24,90)\s*(?:€|EUR)|EUR(?:4\.99|39\.90|3\.90|24\.90)|price:\s*["']?(?:4\.99|39\.90|4\.15|3\.90|24\.90)["']?/i;
// €99/Founding Member is additionally banned below via a JSON-aware check that
// excludes the /refer and /afiliados namespaces, which are explicitly out of
// scope for this pass (see AGENTS-facing task notes) and still mention the
// retired Founding Member tier.
const staleTrialLanguagePattern = /14[- ]day|no credit card/i;
const acquisitionKeyPattern = /trial|offer|acquisition/i;
const flattenStrings = (value, prefix = "") =>
  Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === "string" ? [[path, child]] : flattenStrings(child, path);
  });
// Verified via: grep -rl "lp.shared.trialNote" src --include="*.tsx"
const trialNoteConsumers = [
  "src/components/landing/BudgetApp.tsx",
  "src/components/landing/EtfTracker.tsx",
  "src/components/landing/FeatureAccounts.tsx",
  "src/components/landing/FeatureBudgeting.tsx",
  "src/components/landing/FeatureCategorization.tsx",
  "src/components/landing/FeatureCredits.tsx",
  "src/components/landing/FeatureFinancialMarkets.tsx",
  "src/components/landing/FeatureGoals.tsx",
  "src/components/landing/FeatureNetWorth.tsx",
  "src/components/landing/FeaturePortfolio.tsx",
  "src/components/landing/FeaturePrivacy.tsx",
  "src/components/landing/FeatureReports.tsx",
  "src/components/landing/FireCalculator.tsx",
  "src/components/landing/HowToCalculateNetWorth.tsx",
  "src/components/landing/NetWorthTracker.tsx",
  "src/components/landing/OpenBankingApp.tsx",
  "src/components/landing/PersonalFinanceApp.tsx",
  "src/components/landing/PortfolioTracker.tsx",
  "src/components/landing/sections/AdHero.tsx",
  "src/components/landing/YnabAlternative.tsx",
];
const files = [
  ...locales.flatMap((locale) => [
    `src/locales/${locale}/common.json`,
    `public/locales/${locale}/common.json`,
  ]),
  "src/components/pages/HomePage.astro",
  "src/components/pages/TopLevelPage.astro",
  "src/components/pages/StandaloneLandingPage.astro",
  ...trialNoteConsumers,
];

for (const locale of locales) {
  assert.equal(
    read(`src/locales/${locale}/common.json`),
    read(`public/locales/${locale}/common.json`),
    `${locale} public locale mirror differs from source`,
  );
}

for (const file of files) {
  const content = read(file);
  for (const pattern of [...oneFreeMonthPatterns, ...explicitThirtyDayTrialPatterns]) {
    assert.doesNotMatch(content, pattern, `${file} contains a stale public trial offer`);
  }
  for (const pattern of monthlyAnnualBillingPatterns) {
    assert.doesNotMatch(content, pattern, `${file} pairs a monthly price with annual-billing language`);
  }
  assert.doesNotMatch(content, stalePricePattern, `${file} contains a stale public price`);
  assert.doesNotMatch(content, staleTrialLanguagePattern, `${file} contains stale trial/no-credit-card language — signups are paused, see the FAQ instead`);
}

for (const locale of locales) {
  for (const location of ["src", "public"]) {
    const file = `${location}/locales/${locale}/common.json`;
    for (const [key, value] of flattenStrings(readJson(file))) {
      if (acquisitionKeyPattern.test(key)) {
        assert.doesNotMatch(value, anyThirtyDayPattern, `${file}:${key} contains a stale 30-day acquisition claim`);
      }
    }
  }
}

// €99 / Founding Member: banned everywhere.
const stalePriceNinetyNinePattern = /€99(?:[.,]00)?|99(?:[.,]00)?\s*(?:€|EUR)|EUR99(?:\.00)?|founding member/i;
for (const locale of locales) {
  for (const location of ["src", "public"]) {
    const file = `${location}/locales/${locale}/common.json`;
    for (const [key, value] of flattenStrings(readJson(file))) {
      assert.doesNotMatch(value, stalePriceNinetyNinePattern, `${file}:${key} contains a stale €99/Founding Member claim`);
    }
  }
}

assert.equal(trialNoteConsumers.length, 20);
for (const file of trialNoteConsumers) {
  assert.match(read(file), /t\(["']lp\.shared\.trialNote["']\)/, `${file} must consume lp.shared.trialNote`);
}

for (const file of [
  "src/components/pages/HomePage.astro",
  "src/components/pages/TopLevelPage.astro",
  "src/components/pages/StandaloneLandingPage.astro",
]) {
  const content = read(file);
  assert.doesNotMatch(content, /14-day full-access trial/i, `${file} still advertises a 14-day full-access trial in JSON-LD`);
  assert.doesNotMatch(content, /no credit card/i, `${file} still advertises no-credit-card trial language in JSON-LD`);
  assert.doesNotMatch(content, /(?:price: |"price": )"(?:3\.90|24\.90)"/, `${file} still publishes a stale price in JSON-LD`);
  assert.doesNotMatch(content, /EUR3\.90 monthly plan|EUR24\.90 annual plan|Choose monthly or annual billing/, `${file} still publishes stale plan structured data`);
}

console.log(`Offer alignment passed for ${files.length} active files and all ${trialNoteConsumers.length} trial-note consumers.`);

import { readFileSync } from "node:fs";

const failures: string[] = [];

function fail(message: string) {
  failures.push(message);
}

const expectedMessages: Record<string, Record<string, string>> = {
  en: {
    "activation-setup-progress-title": "Finish setting up your dashboard",
    "activation-setup-progress-nudge":
      "{remaining, plural, =1 {You’re almost there — one more step unlocks a more useful overview.} other {Finish these steps to make your overview more useful.}}",
    "activation-step-transactions": "Review your transactions",
    "activation-step-budget": "Build your first budget",
    "activation-step-portfolio": "Track your investments",
    "activation-setup-view-steps": "Show onboarding steps",
    "activation-setup-hide-steps": "Hide onboarding steps",
  },
  pt: {
    "activation-setup-progress-title": "Termine de configurar o seu dashboard",
    "activation-setup-progress-nudge":
      "{remaining, plural, =1 {Está quase — falta um passo para ter uma visão geral mais útil.} other {Conclua estes passos para ter uma visão geral mais útil.}}",
    "activation-step-transactions": "Reveja as suas transações",
    "activation-step-budget": "Crie o seu primeiro orçamento",
    "activation-step-portfolio": "Acompanhe os seus investimentos",
    "activation-setup-view-steps": "Mostrar passos de onboarding",
    "activation-setup-hide-steps": "Ocultar passos de onboarding",
  },
  es: {
    "activation-setup-progress-title": "Termina de configurar tu dashboard",
    "activation-setup-progress-nudge":
      "{remaining, plural, =1 {Ya casi está — falta un paso para tener una vista general más útil.} other {Completa estos pasos para tener una vista general más útil.}}",
    "activation-step-transactions": "Revisa tus transacciones",
    "activation-step-budget": "Crea tu primer presupuesto",
    "activation-step-portfolio": "Sigue tus inversiones",
    "activation-setup-view-steps": "Mostrar pasos de onboarding",
    "activation-setup-hide-steps": "Ocultar pasos de onboarding",
  },
};

for (const [locale, expected] of Object.entries(expectedMessages)) {
  const messages = JSON.parse(
    readFileSync(`messages/${locale}/common.json`, "utf8"),
  ) as Record<string, string>;

  for (const [key, value] of Object.entries(expected)) {
    if (messages[key] !== value) {
      fail(`${locale} ${key} should be "${value}"`);
    }
  }
}

const source = readFileSync(
  "components/activation/SetupChecklistCard.tsx",
  "utf8",
);

for (const needle of [
  "MoveUpRight",
  "activation-setup-progress-nudge",
  "remainingStepsCount",
  // accessible success token; text-green-600 measured 3.08:1 on the light canvas
  "text-success-text",
  'aria-hidden="true"',
]) {
  if (!source.includes(needle)) {
    fail(`Source should include ${needle}`);
  }
}

const ariaControlsIndex = source.indexOf("aria-controls={stepsListId}");

if (ariaControlsIndex === -1) {
  fail("Step toggle should keep aria-controls for the collapsible steps list");
} else {
  const buttonStart = source.lastIndexOf("<Button", ariaControlsIndex);
  const buttonEnd = source.indexOf("</Button>", ariaControlsIndex);
  const toggleButton = source.slice(buttonStart, buttonEnd);

  if (!toggleButton.includes("aria-label=")) {
    fail("Icon-only step toggle should have an accessible aria-label");
  }

  if (!toggleButton.includes("aria-expanded={isExpanded}")) {
    fail("Step toggle should keep aria-expanded state");
  }

  if (toggleButton.includes("ml-2")) {
    fail("Step toggle should not render chevrons as trailing text-button icons");
  }

  if (
    !toggleButton.includes("ChevronDown") ||
    !toggleButton.includes("ChevronUp")
  ) {
    fail("Step toggle should render chevrons for collapsed and expanded states");
  }
}

if (failures.length > 0) {
  console.error("Onboarding progress card regression checks failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Onboarding progress card regression checks passed");

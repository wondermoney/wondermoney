import type { Lang } from "./i18nLocale";
import { toLocalizedPath, toToolsHubPath } from "./routes";
import { getTranslations } from "./translations";

export function buildResourcesHub(locale: Lang) {
  const t = getTranslations(locale);
  const destinations = {
    guides: `/${locale}/learn`,
    glossary: `/${locale}/glossary`,
    monthly: `/${locale}/learn/monthly`,
    household_budget: toLocalizedPath("toolHouseholdBudget", locale),
    emergency_fund: toLocalizedPath("toolEmergencyFund", locale),
    tools: toToolsHubPath(locale),
  };

  return Object.entries(destinations).map(([destination, href]) => ({
    destination,
    href,
    title: t(`resources.links.${destination}.title`),
    description: t(`resources.links.${destination}.description`),
  }));
}

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

  const links = Object.entries(destinations).map(([destination, href]) => ({
    destination,
    href,
    title: t(`resources.links.${destination}.title`),
    description: t(`resources.links.${destination}.description`),
  }));

  return [
    {
      destination: "guided_start",
      href: toLocalizedPath("pageGuidedStart", locale),
      title: t("guidedStart.title"),
      description: t("guidedStart.intro"),
    },
    ...links,
    {
      destination: "investor_profile",
      href: toLocalizedPath("toolInvestorProfile", locale),
      title: t("tools.investorProfile.title"),
      description: t("tools.investorProfile.description"),
    },
  ];
}

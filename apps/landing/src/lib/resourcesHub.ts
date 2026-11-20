import type { Lang } from "./i18nLocale";
import type { FigureName } from "./hairline/articleFigures";
import { curatedListHubCards } from "./resources/curatedLists";
import { toLocalizedPath, toToolsHubPath } from "./routes";
import { getTranslations } from "./translations";

export interface ResourcesHubLink {
  destination: string;
  href: string;
  title: string;
  description: string;
  /** Set when the destination brings its own figure (a curated list); otherwise figureForResource. */
  figure?: FigureName;
}

export function buildResourcesHub(locale: Lang): ResourcesHubLink[] {
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
      destination: "savings_guide",
      href: toLocalizedPath("pageSavingsGuide", locale),
      title: t("savingsGuide.title"),
      description: t("savingsGuide.hubDescription"),
    },
    {
      destination: "investor_profile",
      href: toLocalizedPath("toolInvestorProfile", locale),
      title: t("tools.investorProfile.title"),
      description: t("tools.investorProfile.description"),
    },
    ...curatedListHubCards(locale, t),
  ];
}

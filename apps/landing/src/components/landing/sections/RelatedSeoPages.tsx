import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { toLocalizedPath, type RouteId } from "@/lib/routes";

// Internal linking map per docs/strategy/SEO_LANDING_PAGES.md §"Internal Linking Map"
const SEO_PAGE_ADJACENCY: Partial<Record<RouteId, ReadonlyArray<RouteId>>> = {
  pageYnabAlternative: ["pageBudgetApp", "pageNetWorthTracker", "pagePortfolioTracker"],
  pageNetWorthTracker: ["pageHowToCalculateNetWorth", "featureAccounts", "pageFireCalculator"],
  pagePortfolioTracker: ["pageEtfTracker", "pageNetWorthTracker"],
  pageFireCalculator: ["pageNetWorthTracker", "pageHowToCalculateNetWorth", "pagePortfolioTracker"],
  pageHowToCalculateNetWorth: ["pageNetWorthTracker", "pageFireCalculator"],
  pageEtfTracker: ["pagePortfolioTracker", "pageNetWorthTracker"],
  pagePersonalFinanceApp: ["pageBudgetApp", "pageOpenBankingApp", "pageNetWorthTracker"],
  pageOpenBankingApp: ["featureAccounts", "pagePersonalFinanceApp", "pageBudgetApp"],
  pageBudgetApp: ["pagePersonalFinanceApp", "pageYnabAlternative", "pageOpenBankingApp"],
};

const TITLE_KEY_BY_ROUTE_ID: Partial<Record<RouteId, string>> = {
  pageYnabAlternative: "lp.ynabAlternative.heroTitle",
  pageNetWorthTracker: "lp.netWorthTracker.heroTitle",
  pagePortfolioTracker: "lp.portfolioTracker.heroTitle",
  pageFireCalculator: "lp.fireCalculator.heroTitle",
  pageHowToCalculateNetWorth: "lp.howToCalculateNetWorth.heroTitle",
  pageEtfTracker: "lp.etfTracker.heroTitle",
  featureAccounts: "lp.featureAccounts.heroTitle",
  pagePersonalFinanceApp: "lp.personalFinanceApp.heroTitle",
  pageOpenBankingApp: "lp.openBankingApp.heroTitle",
  pageBudgetApp: "lp.budgetApp.heroTitle",
};

type Props = { locale: Lang; routeId: RouteId };

export default function RelatedSeoPages({ locale, routeId }: Props) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <RelatedSeoPagesContent locale={locale} routeId={routeId} />
    </ReactTranslationsProvider>
  );
}

function RelatedSeoPagesContent({ locale, routeId }: Props) {
  const { t } = useTranslations();

  const ids = SEO_PAGE_ADJACENCY[routeId] ?? [];
  if (ids.length === 0) return null;

  return (
    <section className="bg-background py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-6 lg:px-8">
        <h2 className="mb-10 text-center text-3xl font-semibold tracking-tight text-foreground">
          {t("lp.shared.relatedFeatures.title")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ids.map((id) => {
            const titleKey = TITLE_KEY_BY_ROUTE_ID[id];
            if (!titleKey) return null;
            return (
              <a
                key={id}
                href={toLocalizedPath(id, locale)}
                className="group flex flex-col rounded-card border border-border bg-background p-6 transition hover:border-primary/40 hover:shadow-sm"
              >
                <h3 className="text-base font-semibold text-foreground group-hover:text-primary">
                  {t(titleKey)}
                </h3>
                <span className="mt-3 text-sm font-medium text-primary underline underline-offset-4 decoration-primary/40">
                  {t("lp.shared.relatedFeatures.cta")}
                </span>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}

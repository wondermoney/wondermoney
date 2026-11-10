import { useEffect, useState, type ReactNode } from "react";

import AccountsPreview from "./previews/AccountsPreview";
import BudgetsPreview from "./previews/BudgetsPreview";
import CategorizationPreview from "./previews/CategorizationPreview";
import GoalsPreview from "./previews/GoalsPreview";
import PortfolioPreview from "./previews/PortfolioPreview";
import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { type RouteId, toLocalizedPath } from "@/lib/routes";

// Net worth is the hero's card, so the stack covers what adds up to it.
type StackItem = {
  id: string;
  /** Key under homepage.stack.* for the title, description and link. */
  key: string;
  /** Short name for the sticky index. */
  indexKey: string;
  routeId: RouteId;
  preview: ReactNode;
};

const items: StackItem[] = [
  { id: "feature-accounts", key: "accounts", indexKey: "preview.accounts.title", routeId: "featureAccounts", preview: <AccountsPreview /> },
  { id: "feature-categorization", key: "categorization", indexKey: "header.nav.categorization.name", routeId: "featureCategorization", preview: <CategorizationPreview /> },
  { id: "feature-budgets", key: "budgets", indexKey: "preview.budgets.title", routeId: "featureBudgeting", preview: <BudgetsPreview /> },
  { id: "feature-goals", key: "goals", indexKey: "preview.goals.title", routeId: "featureGoals", preview: <GoalsPreview limit={2} /> },
  { id: "feature-portfolio", key: "portfolio", indexKey: "preview.portfolio.title", routeId: "featurePortfolio", preview: <PortfolioPreview /> },
];

export default function FeatureStack({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <FeatureStackContent locale={locale} />
    </ReactTranslationsProvider>
  );
}

/**
 * The heading and an index of the features hold still on the left while the
 * features scroll past on the right; the index marks the one in view. With
 * scripting off every feature is still there, the index simply marks none.
 */
function FeatureStackContent({ locale }: { locale: Lang }) {
  const { t } = useTranslations();
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const item of items) {
      const element = document.getElementById(item.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <section id="features" className="border-t border-border bg-paper-2">
      <div className="mx-auto max-w-7xl px-6 py-24 lg:grid lg:grid-cols-12 lg:gap-10 lg:px-8 lg:py-32">
        <div className="min-w-0 lg:col-span-4">
          <div className="lg:sticky lg:top-28">
            <h2 className="text-4xl font-semibold leading-[1.08] tracking-[-0.02em] text-foreground sm:text-5xl lg:text-[3.25rem]">
              {t("homepage.features.headline")}
            </h2>
            <ol className="mt-10 hidden border-l border-border lg:block">
              {items.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    aria-current={active === item.id ? "true" : undefined}
                    className="-ml-px block rounded-r-sm border-l-2 border-transparent py-2 pl-4 text-base text-muted-foreground transition-colors hover:text-foreground aria-[current=true]:border-primary aria-[current=true]:text-foreground"
                  >
                    {t(item.indexKey)}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="mt-16 flex min-w-0 flex-col gap-24 lg:col-span-7 lg:col-start-6 lg:mt-0 lg:gap-32">
          {items.map((item) => (
            <article key={item.id} id={item.id} className="scroll-mt-28">
              <h3 className="text-2xl font-semibold tracking-[-0.01em] text-foreground">
                {t(`homepage.stack.${item.key}.title`)}
              </h3>
              <p className="mt-3 max-w-xl text-base leading-7 text-muted-foreground">
                {t(`homepage.stack.${item.key}.description`)}
              </p>
              <a
                href={toLocalizedPath(item.routeId, locale)}
                className="mt-3 inline-block rounded-sm text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 transition-colors hover:decoration-primary"
              >
                {t(`homepage.stack.${item.key}.link`)}
              </a>
              <div className="mt-8">{item.preview}</div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

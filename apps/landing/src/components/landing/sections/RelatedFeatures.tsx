import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { toLocalizedPath, type RouteId } from "@/lib/routes";

const ADJACENCY: Partial<Record<RouteId, ReadonlyArray<RouteId>>> = {
	featureAccounts: ["featureBudgeting", "featureReports"],
	featureBudgeting: ["featureAccounts", "featureCategorization"],
	featureCategorization: ["featureAccounts", "featureBudgeting"],
	featureCredits: ["featureAccounts", "featureBudgeting", "featurePortfolio"],
	featureFinancialMarkets: ["featurePortfolio", "featureAccounts"],
	featureGoals: ["featureBudgeting", "featurePortfolio", "featureReports"],
	featureNetWorth: ["featureAccounts", "featureGoals", "featureCredits", "featurePortfolio"],
	featurePrivacy: ["featureAccounts", "featurePortfolio"],
	featurePortfolio: ["featureAccounts", "featureBudgeting", "featureReports"],
	featureReports: ["featureBudgeting", "featurePortfolio"],
};

type Props = { locale: Lang; routeId: RouteId };

export default function RelatedFeatures({ locale, routeId }: Props) {
	return (
		<ReactTranslationsProvider locale={locale}>
			<RelatedFeaturesContent locale={locale} routeId={routeId} />
		</ReactTranslationsProvider>
	);
}

function RelatedFeaturesContent({ locale, routeId }: Props) {
	const { t } = useTranslations();

	const ids = ADJACENCY[routeId] ?? [];
	if (ids.length === 0) return null;

	return (
		<section className="bg-background py-16 md:py-20">
			<div className="mx-auto max-w-6xl px-6 lg:px-8">
				<h2 className="mb-10 text-center text-3xl font-semibold tracking-tight text-foreground">
					{t("lp.shared.relatedFeatures.title")}
				</h2>
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{ids.map((id) => (
						<a
							key={id}
							href={toLocalizedPath(id, locale)}
							className="group rounded-card border border-border bg-background p-6 transition-colors hover:border-primary/40 hover:bg-accent"
						>
							<h3 className="text-lg font-semibold text-foreground group-hover:text-primary">
								{t(`lp.${id}.heroTitle`)}
							</h3>
							<p className="mt-2 text-sm leading-6 text-muted-foreground">
								{t(`lp.${id}.heroSubtitle`)}
							</p>
							<span className="mt-4 inline-block text-sm font-medium text-primary underline underline-offset-4 decoration-primary/40 group-hover:opacity-80">
								{t("lp.shared.ctaSecondary")}
							</span>
						</a>
					))}
				</div>
			</div>
		</section>
	);
}

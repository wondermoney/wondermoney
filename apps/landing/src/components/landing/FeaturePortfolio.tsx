import { useTranslations } from "@/lib/reactTranslations";
import { ArrowLeftRight, ArrowUpDown, Building2, CalendarClock, ChartPie, Coins, FileSpreadsheet, Layers, TrendingUp, Wallet } from "lucide-react";

import PortfolioPreview from "@/components/homepage/previews/PortfolioPreview";
import CTABanner from "@/components/shared/CTABanner";
import TrademarkDisclaimer from "@/components/shared/TrademarkDisclaimer";
import { Button } from "@/components/ui/button";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import MidCTA from "@/components/homepage/MidCTA";
import TrustStripInline from "@/components/landing/sections/TrustStripInline";
import FeatureFaq from "@/components/landing/sections/FeatureFaq";
import RelatedFeatures from "@/components/landing/sections/RelatedFeatures";
import FeatureExplainer from "@/components/landing/sections/FeatureExplainer";
import { appSignupUrl } from "@/lib/appLinks";

function StepCard({
	number,
	title,
	body,
}: {
	number: number;
	title: string;
	body: string;
}) {
	return (
		<div className="rounded-card border border-border bg-background p-6">
			<div className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
				{number}
			</div>
			<h3 className="text-base font-semibold text-foreground">{title}</h3>
			<p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
		</div>
	);
}

export default function FeaturePortfolio({ locale }: { locale: Lang }) {
	return (
		<ReactTranslationsProvider locale={locale}>
			<FeaturePortfolioContent locale={locale} />
		</ReactTranslationsProvider>
	);
}

function FeaturePortfolioContent({ locale }: { locale: Lang }) {
	const { t } = useTranslations();

	const features = [
		{ icon: CalendarClock, text: t("lp.featurePortfolio.feature1") },
		{ icon: TrendingUp, text: t("lp.featurePortfolio.feature2") },
		{ icon: ChartPie, text: t("lp.featurePortfolio.feature3") },
		{ icon: ArrowLeftRight, text: t("lp.featurePortfolio.feature4") },
		{ icon: ArrowUpDown, text: t("lp.featurePortfolio.feature5") },
		{ icon: Coins, text: t("lp.featurePortfolio.feature6") },
		{ icon: Layers, text: t("lp.featurePortfolio.feature7") },
		{ icon: Wallet, text: t("lp.featurePortfolio.feature8") },
	];

	const brokers = [
		{ icon: Building2, text: t("lp.featurePortfolio.broker1") },
		{ icon: Building2, text: t("lp.featurePortfolio.broker2") },
		{ icon: Building2, text: t("lp.featurePortfolio.broker3") },
		{ icon: FileSpreadsheet, text: t("lp.featurePortfolio.broker4") },
	];

	return (
		<>
			<section className="bg-background py-16 md:py-24">
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<div className="grid gap-12 lg:grid-cols-2 lg:items-center">
						<div>
							<h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl [text-wrap:balance]">
								<span className="mb-3 block text-xl tracking-normal text-foreground">{t("lp.featurePortfolio.eyebrow")}</span>{" "}
								{t("lp.featurePortfolio.heroTitle")}
							</h1>
							<p className="mt-5 text-lg leading-8 text-muted-foreground">
								{t("lp.featurePortfolio.heroSubtitle")}
							</p>
							<div className="mt-8 flex flex-col items-start gap-3">
								<div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
									<Button asChild size="lg">
										<a
											href={appSignupUrl(locale)}
											onClick={() => pushGtmEvent({ event: "cta_click", cta_position: "hero", page_type: getPageType() })}
										>
											{t("lp.shared.ctaPrimary")}
										</a>
									</Button>
									<p className="text-sm text-muted-foreground">
										{t("lp.shared.trialNote")}
									</p>
								</div>
							</div>
						</div>
						<div className="lg:pl-4">
							<PortfolioPreview />
						</div>
					</div>
				</div>
			</section>

			<section className="bg-paper-2 py-16 md:py-20">
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<h2 className="mb-12 text-center text-3xl font-semibold tracking-tight text-foreground">
						{t("lp.featurePortfolio.howTitle")}
					</h2>
					<div className="grid gap-6 md:grid-cols-3">
						<StepCard
							number={1}
							title={t("lp.featurePortfolio.step1Title")}
							body={t("lp.featurePortfolio.step1Body")}
						/>
						<StepCard
							number={2}
							title={t("lp.featurePortfolio.step2Title")}
							body={t("lp.featurePortfolio.step2Body")}
						/>
						<StepCard
							number={3}
							title={t("lp.featurePortfolio.step3Title")}
							body={t("lp.featurePortfolio.step3Body")}
						/>
					</div>
				</div>
			</section>

			<MidCTA locale={locale} />

			<FeatureExplainer
				title={t("lp.featurePortfolio.brokersTitle")}
				body={t("lp.featurePortfolio.brokersBody")}
				points={brokers}
			/>

			<FeatureExplainer title={t("lp.featurePortfolio.featuresTitle")} points={features} reverse />

			<FeatureFaq routeId="featurePortfolio" />

			<TrustStripInline />

			<RelatedFeatures locale={locale} routeId="featurePortfolio" />

			<section className="py-8 pb-16 md:pb-24">
				<div className="mx-auto max-w-7xl px-6 lg:px-8">
					<CTABanner
						headline={t("lp.featurePortfolio.ctaHeadline")}
						description={t("lp.featurePortfolio.ctaBody")}
					/>
					<div className="mt-8">
						<TrademarkDisclaimer textKey="lp.trademarks.tmDegiroIbkr" />
					</div>
				</div>
			</section>
		</>
	);
}

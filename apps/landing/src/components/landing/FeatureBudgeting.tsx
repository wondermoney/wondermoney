import { useTranslations } from "@/lib/reactTranslations";
import { Button } from "@/components/ui/button";
import { CalendarSync, ChartColumn, RefreshCw, Sparkles, Users, WalletCards } from "lucide-react";
import CTABanner from "@/components/shared/CTABanner";
import BudgetsPreview from "@/components/homepage/previews/BudgetsPreview";
import BudgetEnvelopePreview from "@/components/homepage/previews/BudgetEnvelopePreview";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import MidCTA from "@/components/homepage/MidCTA";
import TrustStripInline from "@/components/landing/sections/TrustStripInline";
import FeatureFaq from "@/components/landing/sections/FeatureFaq";
import RelatedFeatures from "@/components/landing/sections/RelatedFeatures";
import FeatureExplainer from "@/components/landing/sections/FeatureExplainer";
import { appSignupUrl } from "@/lib/appLinks";

function StepCard({ number, title, body }: { number: number; title: string; body: string }) {
	return (
		<div className="flex gap-5">
			<div className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-sm">
				{number}
			</div>
			<div>
				<h3 className="text-base font-semibold text-foreground">{title}</h3>
				<p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
			</div>
		</div>
	);
}

export default function FeatureBudgeting({ locale }: { locale: Lang }) {
	return (
		<ReactTranslationsProvider locale={locale}>
			<FeatureBudgetingContent locale={locale} />
		</ReactTranslationsProvider>
	);
}

function FeatureBudgetingContent({ locale }: { locale: Lang }) {
	const { t } = useTranslations();

	const features = [
		{ icon: WalletCards, text: t("lp.featureBudgeting.feature1") },
		{ icon: RefreshCw, text: t("lp.featureBudgeting.feature2") },
		{ icon: Sparkles, text: t("lp.featureBudgeting.feature3") },
		{ icon: CalendarSync, text: t("lp.featureBudgeting.feature4") },
		{ icon: ChartColumn, text: t("lp.featureBudgeting.feature5") },
		{ icon: Users, text: t("lp.featureBudgeting.feature6") },
	];

	return (
		<>
			{/* Hero — two-column */}
			<section className="bg-background py-16 md:py-24">
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<div className="grid gap-12 lg:grid-cols-2 lg:items-center">
						<div>
							<h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl [text-wrap:balance]">
								<span className="mb-3 block text-xl tracking-normal text-foreground">{t("lp.featureBudgeting.eyebrow")}</span>{" "}
								{t("lp.featureBudgeting.heroTitle")}
							</h1>
							<p className="mt-5 text-lg leading-8 text-muted-foreground">
								{t("lp.featureBudgeting.heroSubtitle")}
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
									<p className="text-sm text-muted-foreground">{t("lp.shared.trialNote")}</p>
								</div>
							</div>
						</div>
						<div className="lg:pl-4">
							<BudgetsPreview />
						</div>
					</div>
				</div>
			</section>

			{/* What is envelope budgeting, beside what the budget does */}
			<FeatureExplainer
				title={t("lp.featureBudgeting.whatTitle")}
				body={t("lp.featureBudgeting.whatBody")}
				pointsTitle={t("lp.featureBudgeting.featuresTitle")}
				points={features}
			/>

			<MidCTA locale={locale} />

			{/* How It Works — steps left, envelope preview right */}
			<section className="py-16 md:py-20 bg-paper-2">
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<h2 className="text-3xl font-semibold tracking-tight text-foreground text-center mb-12">
						{t("lp.featureBudgeting.howTitle")}
					</h2>
					<div className="grid gap-12 lg:grid-cols-2 lg:items-start">
						<div className="flex flex-col gap-10">
							<StepCard number={1} title={t("lp.featureBudgeting.step1Title")} body={t("lp.featureBudgeting.step1Body")} />
							<StepCard number={2} title={t("lp.featureBudgeting.step2Title")} body={t("lp.featureBudgeting.step2Body")} />
							<StepCard number={3} title={t("lp.featureBudgeting.step3Title")} body={t("lp.featureBudgeting.step3Body")} />
							<StepCard number={4} title={t("lp.featureBudgeting.step4Title")} body={t("lp.featureBudgeting.step4Body")} />
						</div>
						<div className="sticky top-4 lg:top-8">
							<BudgetEnvelopePreview />
						</div>
					</div>
				</div>
			</section>

			<FeatureFaq routeId="featureBudgeting" />

			<TrustStripInline />

			<RelatedFeatures locale={locale} routeId="featureBudgeting" />

			{/* CTA */}
			<section className="py-8 pb-16 md:pb-24">
				<div className="mx-auto max-w-7xl px-6 lg:px-8">
					<CTABanner
						headline={t("lp.featureBudgeting.ctaHeadline")}
						description={t("lp.featureBudgeting.ctaBody")}
					/>
				</div>
			</section>
		</>
	);
}

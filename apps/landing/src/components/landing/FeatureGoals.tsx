import { useTranslations } from "@/lib/reactTranslations";
import { CirclePause, GraduationCap, Link2, Target, TrendingUp } from "lucide-react";

import GoalsPreview from "@/components/homepage/previews/GoalsPreview";
import CTABanner from "@/components/shared/CTABanner";
import { Button } from "@/components/ui/button";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import MidCTA from "@/components/homepage/MidCTA";
import TrustStripInline from "@/components/landing/sections/TrustStripInline";
import FeatureFaq from "@/components/landing/sections/FeatureFaq";
import RelatedFeatures from "@/components/landing/sections/RelatedFeatures";
import FeatureExplainer from "@/components/landing/sections/FeatureExplainer";
import ResearchNote from "@/components/landing/sections/ResearchNote";
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

export default function FeatureGoals({ locale }: { locale: Lang }) {
	return (
		<ReactTranslationsProvider locale={locale}>
			<FeatureGoalsContent locale={locale} />
		</ReactTranslationsProvider>
	);
}

function FeatureGoalsContent({ locale }: { locale: Lang }) {
	const { t } = useTranslations();

	const benefits = [
		{ icon: Target, text: t("lp.featureGoals.benefit1") },
		{ icon: TrendingUp, text: t("lp.featureGoals.benefit2") },
		{ icon: CirclePause, text: t("lp.featureGoals.benefit3") },
		{ icon: Link2, text: t("lp.featureGoals.benefit4") },
	];

	return (
		<>
			<section className="bg-background py-16 md:py-24">
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<div className="grid gap-12 lg:grid-cols-2 lg:items-center">
						<div>
							<h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl [text-wrap:balance]">
								<span className="mb-3 block text-xl tracking-normal text-foreground">{t("lp.featureGoals.eyebrow")}</span>{" "}
								{t("lp.featureGoals.heroTitle")}
							</h1>
							<p className="mt-5 text-lg leading-8 text-muted-foreground">
								{t("lp.featureGoals.heroSubtitle")}
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
							<GoalsPreview size="hero" />
						</div>
					</div>
				</div>
			</section>

			<section className="bg-paper-2 py-16 md:py-20">
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<h2 className="mb-12 text-center text-3xl font-semibold tracking-tight text-foreground">
						{t("lp.featureGoals.howTitle")}
					</h2>
					<div className="grid gap-6 md:grid-cols-3">
						<StepCard
							number={1}
							title={t("lp.featureGoals.step1Title")}
							body={t("lp.featureGoals.step1Body")}
						/>
						<StepCard
							number={2}
							title={t("lp.featureGoals.step2Title")}
							body={t("lp.featureGoals.step2Body")}
						/>
						<StepCard
							number={3}
							title={t("lp.featureGoals.step3Title")}
							body={t("lp.featureGoals.step3Body")}
						/>
					</div>
				</div>
			</section>

			<MidCTA locale={locale} />

			<FeatureExplainer title={t("lp.featureGoals.benefitsTitle")} points={benefits}>
				{/*
					Sits beside the benefits, not in the hero. The page's job is to
					convince someone that setting goals is worth the effort at all,
					and that is an argument the product cannot make about itself —
					so it borrows one from research and names the source.
				*/}
				<div className="mt-8">
					<ResearchNote
						icon={GraduationCap}
						noteKey="lp.featureGoals.researchNote"
						sourceKey="lp.featureGoals.researchSource"
					/>
				</div>
			</FeatureExplainer>

			<FeatureFaq routeId="featureGoals" />

			<TrustStripInline />

			<RelatedFeatures locale={locale} routeId="featureGoals" />

			<section className="py-8 pb-16 md:pb-24">
				<div className="mx-auto max-w-7xl px-6 lg:px-8">
					<CTABanner
						headline={t("lp.featureGoals.ctaHeadline")}
						description={t("lp.featureGoals.ctaBody")}
					/>
				</div>
			</section>
		</>
	);
}

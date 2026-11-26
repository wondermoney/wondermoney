import { useTranslations } from "@/lib/reactTranslations";
import { ChartLine, Scale, ShieldCheck, Sigma } from "lucide-react";

import NetWorthPreview from "@/components/homepage/previews/NetWorthPreview";
import { FEATURE_NET_WORTH } from "@/components/homepage/previews/netWorthSample";
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
import { CTA_URL } from "@/hooks/useCtaUrl";

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

export default function FeatureNetWorth({ locale }: { locale: Lang }) {
	return (
		<ReactTranslationsProvider locale={locale}>
			<FeatureNetWorthContent locale={locale} />
		</ReactTranslationsProvider>
	);
}

function FeatureNetWorthContent({ locale }: { locale: Lang }) {
	const { t } = useTranslations();

	const benefits = [
		{ icon: Sigma, text: t("lp.featureNetWorth.benefit1") },
		{ icon: Scale, text: t("lp.featureNetWorth.benefit2") },
		{ icon: ChartLine, text: t("lp.featureNetWorth.benefit3") },
		{ icon: ShieldCheck, text: t("lp.featureNetWorth.benefit4") },
	];

	return (
		<>
			<section className="bg-background py-16 md:py-24">
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<div className="grid gap-12 lg:grid-cols-2 lg:items-center">
						<div>
							<h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl [text-wrap:balance]">
								<span className="mb-3 block text-xl tracking-normal text-foreground">{t("lp.featureNetWorth.eyebrow")}</span>{" "}
								{t("lp.featureNetWorth.heroTitle")}
							</h1>
							<p className="mt-5 text-lg leading-8 text-muted-foreground">
								{t("lp.featureNetWorth.heroSubtitle")}
							</p>
							<div className="mt-8 flex flex-col items-start gap-3">
								<div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
									<Button asChild size="lg">
										<a
											href={CTA_URL}
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
							<NetWorthPreview sample={FEATURE_NET_WORTH} />
						</div>
					</div>
				</div>
			</section>

			<section className="bg-paper-2 py-16 md:py-20">
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<h2 className="mb-12 text-center text-3xl font-semibold tracking-tight text-foreground">
						{t("lp.featureNetWorth.howTitle")}
					</h2>
					<div className="grid gap-6 md:grid-cols-3">
						<StepCard
							number={1}
							title={t("lp.featureNetWorth.step1Title")}
							body={t("lp.featureNetWorth.step1Body")}
						/>
						<StepCard
							number={2}
							title={t("lp.featureNetWorth.step2Title")}
							body={t("lp.featureNetWorth.step2Body")}
						/>
						<StepCard
							number={3}
							title={t("lp.featureNetWorth.step3Title")}
							body={t("lp.featureNetWorth.step3Body")}
						/>
					</div>
				</div>
			</section>

			<MidCTA locale={locale} />

			<FeatureExplainer title={t("lp.featureNetWorth.benefitsTitle")} points={benefits} />

			<FeatureFaq routeId="featureNetWorth" />

			<TrustStripInline />

			<RelatedFeatures locale={locale} routeId="featureNetWorth" />

			<section className="py-8 pb-16 md:pb-24">
				<div className="mx-auto max-w-7xl px-6 lg:px-8">
					<CTABanner
						headline={t("lp.featureNetWorth.ctaHeadline")}
						description={t("lp.featureNetWorth.ctaBody")}
					/>
				</div>
			</section>
		</>
	);
}

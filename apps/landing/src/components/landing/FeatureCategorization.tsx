import { useTranslations } from "@/lib/reactTranslations";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import CTABanner from "@/components/shared/CTABanner";
import CategorizationPreview from "@/components/homepage/previews/CategorizationPreview";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import TrustStripInline from "@/components/landing/sections/TrustStripInline";
import RelatedFeatures from "@/components/landing/sections/RelatedFeatures";
import { CTA_URL } from "@/hooks/useCtaUrl";

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

function FeatureItem({ text }: { text: string }) {
	return (
		<div className="flex items-start gap-3">
			<Check className="mt-0.5 h-5 w-5 shrink-0 text-success-text" aria-hidden="true" />
			<span className="text-foreground text-base">{text}</span>
		</div>
	);
}

export default function FeatureCategorization({ locale }: { locale: Lang }) {
	return (
		<ReactTranslationsProvider locale={locale}>
			<FeatureCategorizationContent locale={locale} />
		</ReactTranslationsProvider>
	);
}

function FeatureCategorizationContent({ locale }: { locale: Lang }) {
	const { t } = useTranslations();

	const features = [
		t("lp.featureCategorization.feature1"),
		t("lp.featureCategorization.feature2"),
		t("lp.featureCategorization.feature3"),
		t("lp.featureCategorization.feature4"),
		t("lp.featureCategorization.feature5"),
		t("lp.featureCategorization.feature6"),
	];

	return (
		<>
			{/* Hero — two-column */}
			<section className="bg-background py-16 md:py-24">
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<div className="grid gap-12 lg:grid-cols-2 lg:items-center">
						<div>
							<h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl [text-wrap:balance]">
								<span className="mb-3 block text-xl tracking-normal text-foreground">{t("lp.featureCategorization.eyebrow")}</span>{" "}
								{t("lp.featureCategorization.heroTitle")}
							</h1>
							<p className="mt-5 text-lg leading-8 text-muted-foreground">
								{t("lp.featureCategorization.heroSubtitle")}
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
									<p className="text-sm text-muted-foreground">{t("lp.shared.trialNote")}</p>
								</div>
							</div>
						</div>
						<div className="lg:pl-4">
							<CategorizationPreview />
						</div>
					</div>
				</div>
			</section>

			{/* How It Works */}
			<section className="py-16 md:py-20">
				<div className="mx-auto max-w-3xl px-6 lg:px-8">
					<h2 className="text-3xl font-semibold tracking-tight text-foreground text-center mb-12">
						{t("lp.featureCategorization.howTitle")}
					</h2>
					<div className="flex flex-col gap-10">
						<StepCard number={1} title={t("lp.featureCategorization.step1Title")} body={t("lp.featureCategorization.step1Body")} />
						<StepCard number={2} title={t("lp.featureCategorization.step2Title")} body={t("lp.featureCategorization.step2Body")} />
						<StepCard number={3} title={t("lp.featureCategorization.step3Title")} body={t("lp.featureCategorization.step3Body")} />
					</div>
				</div>
			</section>

			{/* Features */}
			<section className="py-16 md:py-20 bg-paper-2">
				<div className="mx-auto max-w-3xl px-6 lg:px-8">
					<h2 className="text-3xl font-semibold tracking-tight text-foreground mb-10 text-center">
						{t("lp.featureCategorization.featuresTitle")}
					</h2>
					<div className="grid gap-4 sm:grid-cols-2">
						{features.map((f, i) => <FeatureItem key={i} text={f} />)}
					</div>
				</div>
			</section>

			<TrustStripInline />

			<RelatedFeatures locale={locale} routeId="featureCategorization" />

			{/* CTA */}
			<section className="py-8 pb-16 md:pb-24">
				<div className="mx-auto max-w-7xl px-6 lg:px-8">
					<CTABanner
						headline={t("lp.featureCategorization.ctaHeadline")}
						description={t("lp.featureCategorization.ctaBody")}
					/>
				</div>
			</section>
		</>
	);
}

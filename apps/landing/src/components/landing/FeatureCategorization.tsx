import { useTranslations } from "@/lib/reactTranslations";
import { Button } from "@/components/ui/button";
import { ChartPie, FileDown, History, Lightbulb, ListFilter, MousePointerClick, ScanEye, Shapes, Split, Store, Tags, Wand } from "lucide-react";
import CTABanner from "@/components/shared/CTABanner";
import CategorizationPreview from "@/components/homepage/previews/CategorizationPreview";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import TrustStripInline from "@/components/landing/sections/TrustStripInline";
import RelatedFeatures from "@/components/landing/sections/RelatedFeatures";
import FeatureExplainer from "@/components/landing/sections/FeatureExplainer";
import TransactionsPreview from "@/components/homepage/previews/TransactionsPreview";
import { CTA_URL } from "@/hooks/useCtaUrl";

function StepCard({ number, title, body }: { number: number; title: string; body: string }) {
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
		{ icon: Tags, text: t("lp.featureCategorization.feature1") },
		{ icon: MousePointerClick, text: t("lp.featureCategorization.feature2") },
		{ icon: Store, text: t("lp.featureCategorization.feature3") },
		{ icon: Shapes, text: t("lp.featureCategorization.feature4") },
		{ icon: Split, text: t("lp.featureCategorization.feature5") },
		{ icon: ChartPie, text: t("lp.featureCategorization.feature6") },
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
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<h2 className="text-3xl font-semibold tracking-tight text-foreground text-center mb-12">
						{t("lp.featureCategorization.howTitle")}
					</h2>
					<div className="grid gap-6 md:grid-cols-3">
						<StepCard number={1} title={t("lp.featureCategorization.step1Title")} body={t("lp.featureCategorization.step1Body")} />
						<StepCard number={2} title={t("lp.featureCategorization.step2Title")} body={t("lp.featureCategorization.step2Body")} />
						<StepCard number={3} title={t("lp.featureCategorization.step3Title")} body={t("lp.featureCategorization.step3Body")} />
					</div>
				</div>
			</section>

			{/* Features, beside categorised transactions */}
			<FeatureExplainer
				title={t("lp.featureCategorization.featuresTitle")}
				points={features}
				visual={<TransactionsPreview />}
				tone="muted"
			/>

			{/* Rules: the categorisation the household writes itself */}
			<FeatureExplainer
				title={t("lp.featureCategorization.rulesTitle")}
				body={t("lp.featureCategorization.rulesBody")}
				points={[
					{ icon: ListFilter, text: t("lp.featureCategorization.rulesPoint1") },
					{ icon: Wand, text: t("lp.featureCategorization.rulesPoint2") },
					{ icon: ScanEye, text: t("lp.featureCategorization.rulesPoint3") },
					{ icon: History, text: t("lp.featureCategorization.rulesPoint4") },
					{ icon: Lightbulb, text: t("lp.featureCategorization.rulesPoint5") },
					{ icon: FileDown, text: t("lp.featureCategorization.rulesPoint6") },
				]}
				reverse
			/>

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

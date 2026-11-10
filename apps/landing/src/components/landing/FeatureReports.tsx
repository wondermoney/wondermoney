import { useTranslations } from "@/lib/reactTranslations";
import { Check } from "lucide-react";

import ReportsPreview from "@/components/homepage/previews/ReportsPreview";
import CTABanner from "@/components/shared/CTABanner";
import { Button } from "@/components/ui/button";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import MidCTA from "@/components/homepage/MidCTA";
import TrustStripInline from "@/components/landing/sections/TrustStripInline";
import RelatedFeatures from "@/components/landing/sections/RelatedFeatures";
import { CTA_URL } from "@/hooks/useCtaUrl";

function FeatureItem({ text }: { text: string }) {
	return (
		<div className="flex items-start gap-3">
			<Check className="mt-0.5 h-5 w-5 shrink-0 text-success-text" aria-hidden="true" />
			<span className="text-foreground text-sm">{text}</span>
		</div>
	);
}

function PillarCard({ title, body }: { title: string; body: string }) {
	return (
		<div className="rounded-card border border-border bg-background p-6">
			<h3 className="text-base font-semibold text-foreground">{title}</h3>
			<p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
		</div>
	);
}

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

function FaqItem({ question, answer }: { question: string; answer: string }) {
	return (
		<div className="rounded-card border border-border bg-background p-5">
			<h3 className="text-base font-semibold text-foreground">{question}</h3>
			<p className="mt-2 text-sm leading-6 text-muted-foreground">{answer}</p>
		</div>
	);
}

export default function FeatureReports({ locale }: { locale: Lang }) {
	return (
		<ReactTranslationsProvider locale={locale}>
			<FeatureReportsContent locale={locale} />
		</ReactTranslationsProvider>
	);
}

function FeatureReportsContent({ locale }: { locale: Lang }) {
	const { t } = useTranslations();

	const featureKeys = [
		"lp.featureReports.feature1",
		"lp.featureReports.feature2",
		"lp.featureReports.feature3",
		"lp.featureReports.feature4",
		"lp.featureReports.feature5",
		"lp.featureReports.feature6",
	] as const;

	return (
		<>
			<section className="bg-background py-16 md:py-24">
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<div className="grid gap-12 lg:grid-cols-2 lg:items-center">
						<div>
							<h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl [text-wrap:balance]">
								<span className="mb-3 block text-xl tracking-normal text-foreground">{t("lp.featureReports.eyebrow")}</span>{" "}
								{t("lp.featureReports.heroTitle")}
							</h1>
							<p className="mt-5 text-lg leading-8 text-muted-foreground">
								{t("lp.featureReports.heroSubtitle")}
							</p>
							<p className="mt-4 inline-flex items-center rounded-full border border-warning/30 bg-warning/5 px-3 py-1 text-xs font-semibold text-warning-text">
								{t("lp.featureReports.devStatus")}
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
							<ReportsPreview />
						</div>
					</div>
				</div>
			</section>

			<section className="py-16 md:py-20">
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<h2 className="mb-12 text-center text-3xl font-semibold tracking-tight text-foreground">
						{t("lp.featureReports.pillarsTitle")}
					</h2>
					<div className="grid gap-6 md:grid-cols-3">
						<PillarCard
							title={t("lp.featureReports.pillar1Title")}
							body={t("lp.featureReports.pillar1Body")}
						/>
						<PillarCard
							title={t("lp.featureReports.pillar2Title")}
							body={t("lp.featureReports.pillar2Body")}
						/>
						<PillarCard
							title={t("lp.featureReports.pillar3Title")}
							body={t("lp.featureReports.pillar3Body")}
						/>
					</div>
				</div>
			</section>

			<MidCTA locale={locale} />

			<section className="bg-paper-2 py-16 md:py-20">
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<h2 className="mb-12 text-center text-3xl font-semibold tracking-tight text-foreground">
						{t("lp.featureReports.workflowTitle")}
					</h2>
					<div className="grid gap-6 md:grid-cols-3">
						<StepCard
							number={1}
							title={t("lp.featureReports.step1Title")}
							body={t("lp.featureReports.step1Body")}
						/>
						<StepCard
							number={2}
							title={t("lp.featureReports.step2Title")}
							body={t("lp.featureReports.step2Body")}
						/>
						<StepCard
							number={3}
							title={t("lp.featureReports.step3Title")}
							body={t("lp.featureReports.step3Body")}
						/>
					</div>
				</div>
			</section>

			<section className="py-16 md:py-20">
				<div className="mx-auto max-w-5xl px-6 lg:px-8">
					<h2 className="mb-10 text-center text-3xl font-semibold tracking-tight text-foreground">
						{t("lp.featureReports.featuresTitle")}
					</h2>
					<div className="grid gap-4 sm:grid-cols-2">
						{featureKeys.map((featureKey) => (
							<FeatureItem key={featureKey} text={t(featureKey)} />
						))}
					</div>
				</div>
			</section>

			<section className="bg-paper-2 py-16 md:py-20">
				<div className="mx-auto max-w-4xl px-6 lg:px-8">
					<h2 className="mb-10 text-center text-3xl font-semibold tracking-tight text-foreground">
						{t("lp.featureReports.faqTitle")}
					</h2>
					<div className="grid gap-4">
						<FaqItem
							question={t("lp.featureReports.faq1Q")}
							answer={t("lp.featureReports.faq1A")}
						/>
						<FaqItem
							question={t("lp.featureReports.faq2Q")}
							answer={t("lp.featureReports.faq2A")}
						/>
						<FaqItem
							question={t("lp.featureReports.faq3Q")}
							answer={t("lp.featureReports.faq3A")}
						/>
					</div>
				</div>
			</section>

			<TrustStripInline />

			<RelatedFeatures locale={locale} routeId="featureReports" />

			<section className="py-8 pb-16 md:pb-24">
				<div className="mx-auto max-w-7xl px-6 lg:px-8">
					<CTABanner
						headline={t("lp.featureReports.ctaHeadline")}
						description={t("lp.featureReports.ctaBody")}
					/>
				</div>
			</section>
		</>
	);
}

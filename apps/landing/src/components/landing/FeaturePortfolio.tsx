import { useTranslations } from "@/lib/reactTranslations";
import { Check } from "lucide-react";

import PortfolioPreview from "@/components/homepage/previews/PortfolioPreview";
import CTABanner from "@/components/shared/CTABanner";
import TrademarkDisclaimer from "@/components/shared/TrademarkDisclaimer";
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

export default function FeaturePortfolio({ locale }: { locale: Lang }) {
	return (
		<ReactTranslationsProvider locale={locale}>
			<FeaturePortfolioContent locale={locale} />
		</ReactTranslationsProvider>
	);
}

function FeaturePortfolioContent({ locale }: { locale: Lang }) {
	const { t } = useTranslations();

	const featureKeys = [
		"lp.featurePortfolio.feature1",
		"lp.featurePortfolio.feature2",
		"lp.featurePortfolio.feature3",
		"lp.featurePortfolio.feature4",
		"lp.featurePortfolio.feature5",
		"lp.featurePortfolio.feature6",
		"lp.featurePortfolio.feature7",
		"lp.featurePortfolio.feature8",
	] as const;

	const brokerKeys = [
		"lp.featurePortfolio.broker1",
		"lp.featurePortfolio.broker2",
		"lp.featurePortfolio.broker3",
		"lp.featurePortfolio.broker4",
	] as const;

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

			<section className="py-16 md:py-20">
				<div className="mx-auto max-w-5xl px-6 lg:px-8">
					<h2 className="text-3xl font-semibold tracking-tight text-foreground">
						{t("lp.featurePortfolio.brokersTitle")}
					</h2>
					<p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
						{t("lp.featurePortfolio.brokersBody")}
					</p>
					<div className="mt-8 grid gap-3 sm:grid-cols-2">
						{brokerKeys.map((brokerKey) => (
							<div
								key={brokerKey}
								className="flex items-start gap-3 rounded-card border border-border bg-paper-2 px-4 py-3"
							>
								<Check className="mt-0.5 h-5 w-5 shrink-0 text-success-text" aria-hidden="true" />
								<span className="text-sm text-foreground">{t(brokerKey)}</span>
							</div>
						))}
					</div>
				</div>
			</section>

			<section className="py-16 md:py-20">
				<div className="mx-auto max-w-5xl px-6 lg:px-8">
					<h2 className="mb-10 text-center text-3xl font-semibold tracking-tight text-foreground">
						{t("lp.featurePortfolio.featuresTitle")}
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
						{t("lp.featurePortfolio.faqTitle")}
					</h2>
					<div className="grid gap-4">
						<FaqItem
							question={t("lp.featurePortfolio.faq1Q")}
							answer={t("lp.featurePortfolio.faq1A")}
						/>
						<FaqItem
							question={t("lp.featurePortfolio.faq2Q")}
							answer={t("lp.featurePortfolio.faq2A")}
						/>
						<FaqItem
							question={t("lp.featurePortfolio.faq3Q")}
							answer={t("lp.featurePortfolio.faq3A")}
						/>
					</div>
				</div>
			</section>

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

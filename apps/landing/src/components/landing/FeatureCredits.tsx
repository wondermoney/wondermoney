import { useTranslations } from "@/lib/reactTranslations";
import { Check } from "lucide-react";

import CreditsPreview from "@/components/homepage/previews/CreditsPreview";
import CTABanner from "@/components/shared/CTABanner";
import { Button } from "@/components/ui/button";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import MidCTA from "@/components/homepage/MidCTA";
import TrustStripInline from "@/components/landing/sections/TrustStripInline";
import RelatedFeatures from "@/components/landing/sections/RelatedFeatures";
import { CTA_URL } from "@/hooks/useCtaUrl";

function BenefitItem({ text }: { text: string }) {
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

export default function FeatureCredits({ locale }: { locale: Lang }) {
	return (
		<ReactTranslationsProvider locale={locale}>
			<FeatureCreditsContent locale={locale} />
		</ReactTranslationsProvider>
	);
}

function FeatureCreditsContent({ locale }: { locale: Lang }) {
	const { t } = useTranslations();

	const benefitKeys = [
		"lp.featureCredits.benefit1",
		"lp.featureCredits.benefit2",
		"lp.featureCredits.benefit3",
		"lp.featureCredits.benefit4",
	] as const;

	return (
		<>
			<section className="bg-background py-16 md:py-24">
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<div className="grid gap-12 lg:grid-cols-2 lg:items-center">
						<div>
							<h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl [text-wrap:balance]">
								<span className="mb-3 block text-xl tracking-normal text-foreground">{t("lp.featureCredits.eyebrow")}</span>{" "}
								{t("lp.featureCredits.heroTitle")}
							</h1>
							<p className="mt-5 text-lg leading-8 text-muted-foreground">
								{t("lp.featureCredits.heroSubtitle")}
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
							<CreditsPreview size="hero" />
						</div>
					</div>
				</div>
			</section>

			<section className="bg-paper-2 py-16 md:py-20">
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<h2 className="mb-12 text-center text-3xl font-semibold tracking-tight text-foreground">
						{t("lp.featureCredits.howTitle")}
					</h2>
					<div className="grid gap-6 md:grid-cols-3">
						<StepCard
							number={1}
							title={t("lp.featureCredits.step1Title")}
							body={t("lp.featureCredits.step1Body")}
						/>
						<StepCard
							number={2}
							title={t("lp.featureCredits.step2Title")}
							body={t("lp.featureCredits.step2Body")}
						/>
						<StepCard
							number={3}
							title={t("lp.featureCredits.step3Title")}
							body={t("lp.featureCredits.step3Body")}
						/>
					</div>
				</div>
			</section>

			<MidCTA locale={locale} />

			<section className="py-16 md:py-20">
				<div className="mx-auto max-w-5xl px-6 lg:px-8">
					<h2 className="mb-10 text-center text-3xl font-semibold tracking-tight text-foreground">
						{t("lp.featureCredits.benefitsTitle")}
					</h2>
					<div className="grid gap-4 sm:grid-cols-2">
						{benefitKeys.map((key) => (
							<BenefitItem key={key} text={t(key)} />
						))}
					</div>
				</div>
			</section>

			<section className="bg-paper-2 py-16 md:py-20">
				<div className="mx-auto max-w-4xl px-6 lg:px-8">
					<h2 className="mb-10 text-center text-3xl font-semibold tracking-tight text-foreground">
						{t("lp.featureCredits.faqTitle")}
					</h2>
					<div className="grid gap-4">
						<FaqItem
							question={t("lp.featureCredits.faq1Q")}
							answer={t("lp.featureCredits.faq1A")}
						/>
						<FaqItem
							question={t("lp.featureCredits.faq2Q")}
							answer={t("lp.featureCredits.faq2A")}
						/>
						<FaqItem
							question={t("lp.featureCredits.faq3Q")}
							answer={t("lp.featureCredits.faq3A")}
						/>
					</div>
				</div>
			</section>

			<TrustStripInline />

			<RelatedFeatures locale={locale} routeId="featureCredits" />

			<section className="py-8 pb-16 md:pb-24">
				<div className="mx-auto max-w-7xl px-6 lg:px-8">
					<CTABanner
						headline={t("lp.featureCredits.ctaHeadline")}
						description={t("lp.featureCredits.ctaBody")}
					/>
				</div>
			</section>
		</>
	);
}

import type { ComponentType } from "react";
import { useTranslations, ReactTranslationsProvider } from "@/lib/reactTranslations";
import { Button } from "@/components/ui/button";
import CTABanner from "@/components/shared/CTABanner";
import MidCTA from "@/components/homepage/MidCTA";
import TrustStripInline from "@/components/landing/sections/TrustStripInline";
import FeatureFaq from "@/components/landing/sections/FeatureFaq";
import RelatedFeatures from "@/components/landing/sections/RelatedFeatures";
import FeatureExplainer from "@/components/landing/sections/FeatureExplainer";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import { appSignupUrl } from "@/lib/appLinks";
import type { Lang } from "@/lib/i18nLocale";
import { FEATURE_DETAILS, type FeatureDetailRouteId, type FeatureDetailSection } from "./featureDetails";

/**
 * One page for each feature added in #600, built from `featureDetails.ts`: the hero with the
 * feature's preview, its explanatory sections (FeatureExplainer), three steps, three questions
 * and the closing card. The copy is `lp.<namespace>.*` in every locale.
 */
export default function FeatureDetail({ locale, routeId }: { locale: Lang; routeId: FeatureDetailRouteId }) {
	return (
		<ReactTranslationsProvider locale={locale}>
			<FeatureDetailContent locale={locale} routeId={routeId} />
		</ReactTranslationsProvider>
	);
}

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

function DetailSection({ ns, section }: { ns: string; section: FeatureDetailSection }) {
	const { t } = useTranslations();
	const key = (suffix: string) => `lp.${ns}.${section.key}${suffix}`;
	const Visual: ComponentType | undefined = section.visual;

	return (
		<FeatureExplainer
			title={t(key("Title"))}
			body={section.body ? t(key("Body")) : undefined}
			pointsTitle={section.pointsTitle ? t(key("PointsTitle")) : undefined}
			points={section.icons.map((icon, index) =>
				section.titledPoints
					? { icon, title: t(key(`Point${index + 1}Title`)), text: t(key(`Point${index + 1}Body`)) }
					: { icon, text: t(key(`Point${index + 1}`)) },
			)}
			visual={Visual ? <Visual /> : undefined}
			tone={section.tone}
			reverse={section.reverse}
			columns={section.columns}
		/>
	);
}

const STEP_NUMBERS = [1, 2, 3] as const;

function FeatureDetailContent({ locale, routeId }: { locale: Lang; routeId: FeatureDetailRouteId }) {
	const { t } = useTranslations();
	const { ns, Preview, sections } = FEATURE_DETAILS[routeId];
	const [first, ...rest] = sections;

	return (
		<>
			<section className="bg-background py-16 md:py-24">
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<div className="grid gap-12 lg:grid-cols-2 lg:items-center">
						<div>
							<h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl [text-wrap:balance]">
								<span className="mb-3 block text-xl tracking-normal text-foreground">{t(`lp.${ns}.eyebrow`)}</span>{" "}
								{t(`lp.${ns}.heroTitle`)}
							</h1>
							<p className="mt-5 text-lg leading-8 text-muted-foreground">{t(`lp.${ns}.heroSubtitle`)}</p>
							<div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
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
						<div className="min-w-0 lg:pl-4">
							<Preview />
						</div>
					</div>
				</div>
			</section>

			<DetailSection ns={ns} section={first} />

			<MidCTA locale={locale} />

			<section className="bg-paper-2 py-16 md:py-20">
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<h2 className="mb-12 text-center text-3xl font-semibold tracking-tight text-foreground">
						{t(`lp.${ns}.howTitle`)}
					</h2>
					<div className="grid gap-6 md:grid-cols-3">
						{STEP_NUMBERS.map((n) => (
							<StepCard
								key={n}
								number={n}
								title={t(`lp.${ns}.step${n}Title`)}
								body={t(`lp.${ns}.step${n}Body`)}
							/>
						))}
					</div>
				</div>
			</section>

			{rest.map((section) => (
				<DetailSection key={section.key} ns={ns} section={section} />
			))}

			<FeatureFaq routeId={routeId} />

			<TrustStripInline />

			<RelatedFeatures locale={locale} routeId={routeId} />

			<section className="py-8 pb-16 md:pb-24">
				<div className="mx-auto max-w-7xl px-6 lg:px-8">
					<CTABanner headline={t(`lp.${ns}.ctaHeadline`)} description={t(`lp.${ns}.ctaBody`)} />
				</div>
			</section>
		</>
	);
}

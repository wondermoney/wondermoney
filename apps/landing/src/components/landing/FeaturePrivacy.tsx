import { useTranslations } from "@/lib/reactTranslations";
import { EyeOff, Ban, Server, KeyRound, LogOut, FingerprintPattern } from "lucide-react";
import { Button } from "@/components/ui/button";
import CTABanner from "@/components/shared/CTABanner";
import SecurityDashboardPreview from "@/components/homepage/previews/SecurityDashboardPreview";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import TrustStripInline from "@/components/landing/sections/TrustStripInline";
import RelatedFeatures from "@/components/landing/sections/RelatedFeatures";
import { CTA_URL } from "@/hooks/useCtaUrl";

const principles = [
	{ icon: EyeOff, titleKey: "principle1Title", bodyKey: "principle1Body" },
	{ icon: Ban, titleKey: "principle2Title", bodyKey: "principle2Body" },
	{ icon: Server, titleKey: "principle3Title", bodyKey: "principle3Body" },
	{ icon: KeyRound, titleKey: "principle4Title", bodyKey: "principle4Body" },
	{ icon: LogOut, titleKey: "principle5Title", bodyKey: "principle5Body" },
	{ icon: FingerprintPattern, titleKey: "principle6Title", bodyKey: "principle6Body" },
] as const;

function PrincipleCard({
	icon: Icon,
	title,
	body,
}: {
	icon: React.ElementType;
	title: string;
	body: string;
}) {
	return (
		<div className="ring-1 ring-border rounded-card p-6 bg-background">
			<Icon className="h-8 w-8 text-primary" />
			<h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
			<p className="mt-2 text-sm text-muted-foreground leading-6">{body}</p>
		</div>
	);
}

export default function FeaturePrivacy({ locale }: { locale: Lang }) {
	return (
		<ReactTranslationsProvider locale={locale}>
			<FeaturePrivacyContent locale={locale} />
		</ReactTranslationsProvider>
	);
}

function FeaturePrivacyContent({ locale }: { locale: Lang }) {
	const { t } = useTranslations();

	return (
		<>
			{/* Hero — two-column */}
			<section className="bg-background py-16 md:py-24">
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<div className="grid gap-12 lg:grid-cols-2 lg:items-center">
						<div>
							<h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl [text-wrap:balance]">
								<span className="mb-3 block text-xl tracking-normal text-foreground">{t("lp.featurePrivacy.eyebrow")}</span>{" "}
								{t("lp.featurePrivacy.heroTitle")}
							</h1>
							<p className="mt-5 text-lg leading-8 text-muted-foreground">
								{t("lp.featurePrivacy.heroSubtitle")}
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
							<SecurityDashboardPreview />
						</div>
					</div>
				</div>
			</section>

			{/* Principles */}
			<section className="py-16 md:py-20">
				<div className="mx-auto max-w-5xl px-6 lg:px-8">
					<h2 className="text-3xl font-semibold tracking-tight text-foreground text-center mb-12">
						{t("lp.featurePrivacy.principlesTitle")}
					</h2>
					<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
						{principles.map((p) => (
							<PrincipleCard
								key={p.titleKey}
								icon={p.icon}
								title={t(`lp.featurePrivacy.${p.titleKey}`)}
								body={t(`lp.featurePrivacy.${p.bodyKey}`)}
							/>
						))}
					</div>
				</div>
			</section>

			{/* Open Banking trust details */}
			<section className="py-16 md:py-20 bg-paper-2">
				<div className="mx-auto max-w-3xl px-6 lg:px-8">
					<h2 className="text-3xl font-semibold tracking-tight text-foreground mb-4">
						{t("lp.featurePrivacy.gdprTitle")}
					</h2>
					<p className="text-muted-foreground leading-7 mb-10">
						{t("lp.featurePrivacy.gdprBody")}
					</p>
					<h2 className="text-3xl font-semibold tracking-tight text-foreground mb-4 mt-10">
						{t("lp.featurePrivacy.openBankingTitle")}
					</h2>
					<p className="max-w-[60ch] text-muted-foreground leading-7">
						{t("lp.featurePrivacy.openBankingBody")}
					</p>
				</div>
			</section>

			<TrustStripInline />

			<RelatedFeatures locale={locale} routeId="featurePrivacy" />

			{/* CTA */}
			<section className="py-8 pb-16 md:pb-24">
				<div className="mx-auto max-w-7xl px-6 lg:px-8">
					<CTABanner
						headline={t("lp.featurePrivacy.ctaHeadline")}
						description={t("lp.featurePrivacy.ctaBody")}
					/>
				</div>
			</section>
		</>
	);
}

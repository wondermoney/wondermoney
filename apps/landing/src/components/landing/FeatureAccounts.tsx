import { useTranslations } from "@/lib/reactTranslations";
import { CreditCard, Eye, History, Landmark, Lock, ShieldCheck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import CTABanner from "@/components/shared/CTABanner";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import AccountsPreview from "@/components/homepage/previews/AccountsPreview";
import TransactionsPreview from "@/components/homepage/previews/TransactionsPreview";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import MidCTA from "@/components/homepage/MidCTA";
import TrustStripInline from "@/components/landing/sections/TrustStripInline";
import FeatureFaq from "@/components/landing/sections/FeatureFaq";
import RelatedFeatures from "@/components/landing/sections/RelatedFeatures";
import FeatureExplainer from "@/components/landing/sections/FeatureExplainer";
import { CTA_URL } from "@/hooks/useCtaUrl";

function SecurityCard({ icon: Icon, title, body }: { icon: React.ElementType; title: string; body: string }) {
	return (
		<div className="rounded-card border border-border bg-background p-6">
			<Icon className="h-8 w-8 text-primary mb-3" />
			<h3 className="text-base font-semibold text-foreground">{title}</h3>
			<p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
		</div>
	);
}

export default function FeatureAccounts({ locale }: { locale: Lang }) {
	return (
		<ReactTranslationsProvider locale={locale}>
			<FeatureAccountsContent locale={locale} />
		</ReactTranslationsProvider>
	);
}

function FeatureAccountsContent({ locale }: { locale: Lang }) {
	const { t } = useTranslations();

	return (
		<>
			{/* Hero — two-column */}
			<section className="bg-background py-16 md:py-24">
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<div className="grid gap-12 lg:grid-cols-2 lg:items-center">
						<div>
							<h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl [text-wrap:balance]">
								<span className="mb-3 block text-xl tracking-normal text-foreground">{t("lp.featureAccounts.eyebrow")}</span>{" "}
								{t("lp.featureAccounts.heroTitle")}
							</h1>
							<p className="mt-5 text-lg leading-8 text-muted-foreground">
								{t("lp.featureAccounts.heroSubtitle")}
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
							<AccountsPreview />
						</div>
					</div>
				</div>
			</section>

			{/* How open banking works, beside what it syncs */}
			<FeatureExplainer
				title={t("lp.featureAccounts.whatTitle")}
				body={t("lp.featureAccounts.whatBody")}
				pointsTitle={t("lp.featureAccounts.syncTitle")}
				points={[
					{ icon: Wallet, text: t("lp.featureAccounts.sync1") },
					{ icon: History, text: t("lp.featureAccounts.sync2") },
					{ icon: CreditCard, text: t("lp.featureAccounts.sync3") },
					{ icon: Landmark, text: t("lp.featureAccounts.sync4") },
				]}
			/>

			<MidCTA locale={locale} />

			{/* Security */}
			<section className="py-16 md:py-20 bg-paper-2">
				<div className="mx-auto max-w-5xl px-6 lg:px-8">
					<h2 className="text-3xl font-semibold tracking-tight text-foreground text-center mb-12">
						{t("lp.featureAccounts.secureTitle")}
					</h2>
					<div className="grid gap-6 md:grid-cols-3">
						<SecurityCard icon={Eye} title={t("lp.featureAccounts.secure1Title")} body={t("lp.featureAccounts.secure1Body")} />
						<SecurityCard icon={Lock} title={t("lp.featureAccounts.secure2Title")} body={t("lp.featureAccounts.secure2Body")} />
						<SecurityCard icon={ShieldCheck} title={t("lp.featureAccounts.secure3Title")} body={t("lp.featureAccounts.secure3Body")} />
					</div>
				</div>
			</section>

			{/* Bank coverage, with TransactionsPreview */}
			<section className="py-16 md:py-20">
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<div className="grid gap-12 lg:grid-cols-2 lg:items-center">
						<div>
							<h2 className="text-3xl font-semibold tracking-tight text-foreground mb-4">
								{t("lp.featureAccounts.banksTitle")}
							</h2>
							<p className="max-w-[65ch] text-ink-2 leading-7">
								{t("lp.featureAccounts.banksBody")}
							</p>
						</div>
						<div>
							<TransactionsPreview />
						</div>
					</div>
				</div>
			</section>

			<FeatureFaq routeId="featureAccounts" />

			<TrustStripInline />

			<RelatedFeatures locale={locale} routeId="featureAccounts" />

			{/* CTA */}
			<section className="py-8 pb-16 md:pb-24">
				<div className="mx-auto max-w-7xl px-6 lg:px-8">
					<CTABanner
						headline={t("lp.featureAccounts.ctaHeadline")}
						description={t("lp.featureAccounts.ctaBody")}
					/>
				</div>
			</section>
		</>
	);
}

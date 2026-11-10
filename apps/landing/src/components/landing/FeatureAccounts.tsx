import { useTranslations } from "@/lib/reactTranslations";
import { Eye, Lock, ShieldCheck, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import CTABanner from "@/components/shared/CTABanner";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import AccountsPreview from "@/components/homepage/previews/AccountsPreview";
import TransactionsPreview from "@/components/homepage/previews/TransactionsPreview";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import MidCTA from "@/components/homepage/MidCTA";
import TrustStripInline from "@/components/landing/sections/TrustStripInline";
import RelatedFeatures from "@/components/landing/sections/RelatedFeatures";
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

			{/* How Open Banking Works */}
			<section className="py-16 md:py-20">
				<div className="mx-auto max-w-3xl px-6 lg:px-8">
					<h2 className="text-3xl font-semibold tracking-tight text-foreground mb-6">
						{t("lp.featureAccounts.whatTitle")}
					</h2>
					<p className="max-w-[60ch] text-muted-foreground leading-7">
						{t("lp.featureAccounts.whatBody")}
					</p>
				</div>
			</section>

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

			{/* Bank Coverage + What Syncs — with TransactionsPreview */}
			<section className="py-16 md:py-20">
				<div className="mx-auto max-w-6xl px-6 lg:px-8">
					<div className="grid gap-12 lg:grid-cols-2 lg:items-start">
						<div>
							<h2 className="text-3xl font-semibold tracking-tight text-foreground mb-4">
								{t("lp.featureAccounts.banksTitle")}
							</h2>
							<p className="text-muted-foreground leading-7 mb-10">
								{t("lp.featureAccounts.banksBody")}
							</p>
							<h3 className="text-xl font-semibold text-foreground mb-6">
								{t("lp.featureAccounts.syncTitle")}
							</h3>
							<div className="grid gap-3 sm:grid-cols-2">
								{[
									t("lp.featureAccounts.sync1"),
									t("lp.featureAccounts.sync2"),
									t("lp.featureAccounts.sync3"),
									t("lp.featureAccounts.sync4"),
								].map((item, i) => (
									<div key={i} className="flex items-start gap-3">
										<Check className="mt-0.5 h-5 w-5 shrink-0 text-success-text" aria-hidden="true" />
										<span className="text-foreground text-sm">{item}</span>
									</div>
								))}
							</div>
						</div>
						<div>
							<TransactionsPreview />
						</div>
					</div>
				</div>
			</section>

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

import BackgroundPattern from "./BackgroundPattern";
import InstitutionMarks from "./InstitutionMarks";
import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

const steps = ["step1", "step2", "step3"] as const;

export default function HowItWorks({ locale }: { locale: Lang }) {
	return (
		<ReactTranslationsProvider locale={locale}>
			<HowItWorksContent />
		</ReactTranslationsProvider>
	);
}

// Getting started in three steps across one row, then the banks and brokers
// the first step connects.
function HowItWorksContent() {
	const { t } = useTranslations();

	return (
		<section className="relative isolate border-t border-border bg-background">
			<BackgroundPattern pattern="dots" fade="top" />
			<div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
				<h2 className="text-4xl font-semibold leading-[1.08] tracking-[-0.02em] text-foreground sm:text-5xl lg:text-[3.25rem]">
					{t("homepage.howItWorksSteps.title")}
				</h2>
				<ol className="mt-16 grid gap-10 sm:grid-cols-3">
					{steps.map((step, index) => (
						<li key={step} className="min-w-0 border-t border-border pt-6">
							<span className="text-sm text-muted-foreground">{index + 1}</span>
							<h3 className="mt-2 text-lg font-semibold text-foreground">
								{t(`homepage.howItWorksSteps.${step}.title`)}
							</h3>
							<p className="mt-2 text-base leading-7 text-muted-foreground">
								{t(`homepage.howItWorksSteps.${step}.description`)}
							</p>
						</li>
					))}
				</ol>
				<div className="mt-20 grid gap-10 border-t border-border pt-12 lg:grid-cols-12 lg:gap-10">
					<div className="min-w-0 lg:col-span-4">
						<h3 className="text-lg font-semibold text-foreground">
							{t("homepage.worksWith.title")}
						</h3>
						<p className="mt-2 text-base leading-7 text-muted-foreground">
							{t("homepage.worksWith.body")}
						</p>
					</div>
					<div className="min-w-0 lg:col-span-7 lg:col-start-6">
						<InstitutionMarks size="large" />
					</div>
				</div>
			</div>
		</section>
	);
}

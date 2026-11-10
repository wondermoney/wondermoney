import { Lock, Sparkles, Target } from "lucide-react";

import Section from "../shared/Section";
import { useTranslations } from "@/lib/reactTranslations";
import { toLocalizedPath } from "@/lib/routes";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

type SecondaryFeature = {
	name: string;
	description: string;
	icon: React.ElementType;
	href: string;
};

export default function SecondaryFeatures({ locale }: { locale: Lang }) {
	return (
		<ReactTranslationsProvider locale={locale}>
			<SecondaryFeaturesContent locale={locale} />
		</ReactTranslationsProvider>
	);
}

function SecondaryFeaturesContent({ locale }: { locale: Lang }) {
	const { t } = useTranslations();

	const features: SecondaryFeature[] = [
		{
			name: t("homepage.secondaryFeatures.goals.title"),
			description: t("homepage.secondaryFeatures.goals.description"),
			icon: Target,
			href: toLocalizedPath("featureGoals", locale),
		},
		{
			name: t("homepage.secondaryFeatures.categorization.title"),
			description: t("homepage.secondaryFeatures.categorization.description"),
			icon: Sparkles,
			href: toLocalizedPath("featureCategorization", locale),
		},
		{
			name: t("homepage.secondaryFeatures.privacy.title"),
			description: t("homepage.secondaryFeatures.privacy.description"),
			icon: Lock,
			href: toLocalizedPath("featurePrivacy", locale),
		},
	];

	return (
		<Section
			id="more-features"
			title={t("homepage.secondaryFeatures.title")}
			subTitle={t("homepage.secondaryFeatures.subTitle")}
			className="bg-paper-2"
		>
			<ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
				{features.map((feature) => (
					<li
						key={feature.name}
						className="rounded-card border border-border bg-background p-6 transition-colors hover:border-primary/40 hover:bg-accent"
					>
						<a href={feature.href} className="block">
							<h3 className="flex items-center gap-3 font-semibold text-foreground">
								<feature.icon className="h-5 w-5 flex-none text-primary" aria-hidden="true" />
								{feature.name}
							</h3>
							<p className="mt-3 text-muted-foreground">
								{feature.description}
							</p>
							<p className="mt-4 text-sm font-medium text-primary underline underline-offset-4 decoration-primary/40">
								{t("homepage.secondaryFeatures.learnMore")}
							</p>
						</a>
					</li>
				))}
			</ul>
		</Section>
	);
}

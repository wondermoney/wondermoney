import Section from "../shared/Section";
import FeaturePreviewList from "./FeaturePreviewList";
import InstitutionMarks from "./InstitutionMarks";
import AccountsPreview from "./previews/AccountsPreview";
import BudgetsPreview from "./previews/BudgetsPreview";
import NetWorthPreview from "./previews/NetWorthPreview";
import PortfolioPreview from "./previews/PortfolioPreview";
import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

export default function Features({ locale }: { locale: Lang }) {
	return (
		<ReactTranslationsProvider locale={locale}>
			<FeaturesContent />
		</ReactTranslationsProvider>
	);
}

function FeaturesContent() {
	const { t } = useTranslations();

	const features = [
		{
			id: "feature-1",
			title: t("homepage.features.item1.title"),
			description: t("homepage.features.item1.description"),
			status: t("homepage.features.item1.status", { defaultValue: "" }),
			supporting: <InstitutionMarks />,
			preview: <AccountsPreview />,
		},
		{
			id: "feature-2",
			title: t("homepage.features.item2.title"),
			description: t("homepage.features.item2.description"),
			status: t("homepage.features.item2.status", { defaultValue: "" }),
			preview: <BudgetsPreview />,
		},
		{
			id: "feature-3",
			title: t("homepage.features.item3.title"),
			description: t("homepage.features.item3.description"),
			status: t("homepage.features.item3.status", { defaultValue: "" }),
			preview: <PortfolioPreview />,
		},
		{
			id: "feature-5",
			title: t("homepage.features.item5.title"),
			description: t("homepage.features.item5.description"),
			status: t("homepage.features.item5.status", { defaultValue: "" }),
			preview: <NetWorthPreview />,
		},
	];

	return (
		<Section
			id="features"
			title={t("homepage.features.headline")}
			subTitle={t("homepage.features.subheadline")}
		>
			<FeaturePreviewList features={features} />
		</Section>
	);
}

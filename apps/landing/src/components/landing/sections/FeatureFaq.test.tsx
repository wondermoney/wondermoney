import type { ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FeatureAccounts from "../FeatureAccounts";
import FeatureBudgeting from "../FeatureBudgeting";
import FeatureCategorization from "../FeatureCategorization";
import FeatureCredits from "../FeatureCredits";
import FeatureFinancialMarkets from "../FeatureFinancialMarkets";
import FeatureGoals from "../FeatureGoals";
import FeatureNetWorth from "../FeatureNetWorth";
import FeaturePortfolio from "../FeaturePortfolio";
import FeaturePrivacy from "../FeaturePrivacy";
import FeatureReports from "../FeatureReports";
import FeatureDetail from "../FeatureDetail";
import { FEATURE_DETAIL_ROUTE_IDS } from "../featureDetails";
import { featureFaq } from "@/lib/faq";
import { FEATURE_ROUTE_IDS, SUPPORTED_LANGS, type Lang } from "@/lib/routes";
import { buildFaqPageSchema } from "@/lib/structuredData";
import { getTranslations } from "@/lib/translations";

// The page components FeaturePage.astro renders, one per feature route.
const FEATURE_PAGES = {
	featureAccounts: FeatureAccounts,
	featureBudgeting: FeatureBudgeting,
	featureCategorization: FeatureCategorization,
	featureCredits: FeatureCredits,
	featureFinancialMarkets: FeatureFinancialMarkets,
	featureGoals: FeatureGoals,
	featureNetWorth: FeatureNetWorth,
	featurePrivacy: FeaturePrivacy,
	featurePortfolio: FeaturePortfolio,
	featureReports: FeatureReports,
	...Object.fromEntries(
		FEATURE_DETAIL_ROUTE_IDS.map((routeId) => [
			routeId,
			({ locale }: { locale: Lang }) => <FeatureDetail locale={locale} routeId={routeId} />,
		]),
	),
} as Record<(typeof FEATURE_ROUTE_IDS)[number], ComponentType<{ locale: Lang }>>;

const asHtml = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

describe("feature page FAQ", () => {
	describe.each(SUPPORTED_LANGS)("%s", (locale) => {
		const t = getTranslations(locale);

		it.each(FEATURE_ROUTE_IDS)("%s shows the questions and answers its FAQPage JSON-LD states", (routeId) => {
			const Page = FEATURE_PAGES[routeId];
			const html = renderToString(<Page locale={locale} />);
			const entries = featureFaq(locale, routeId);

			expect(entries).toHaveLength(3);
			expect(html).toContain(asHtml(t(`lp.${routeId}.faqTitle`)));
			for (const { question, answer } of entries) {
				expect(question.trim()).not.toBe("");
				expect(answer.trim()).not.toBe("");
				expect(html).toContain(`>${asHtml(question)}</h3>`);
				expect(html).toContain(`>${asHtml(answer)}</p>`);
			}

			const schema = JSON.parse(JSON.stringify(buildFaqPageSchema(entries))) as {
				"@type": string;
				mainEntity: Array<{ "@type": string; name: string; acceptedAnswer: { "@type": string; text: string } }>;
			};
			expect(schema["@type"]).toBe("FAQPage");
			expect(schema.mainEntity.map(({ name, acceptedAnswer }) => [name, acceptedAnswer.text])).toEqual(
				entries.map(({ question, answer }) => [question, answer]),
			);
			expect(schema.mainEntity.every((item) => item["@type"] === "Question" && item.acceptedAnswer["@type"] === "Answer")).toBe(true);
		});
	});
});

import type { ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Sparkles, Users } from "lucide-react";
import FeatureExplainer from "./FeatureExplainer";
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
import { FEATURE_ROUTE_IDS, SUPPORTED_LANGS, type Lang } from "@/lib/routes";

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

function explainerSections(html: string): string[] {
	return html.split("<section").filter((chunk) => chunk.includes("data-feature-explainer"));
}

describe("FeatureExplainer", () => {
	it("lays the text beside an icon list and holds the paragraph to a reading width", () => {
		const html = renderToString(
			<FeatureExplainer
				title="What is envelope budgeting?"
				body="Give every euro a job."
				pointsTitle="Budgeting features"
				points={[
					{ icon: Sparkles, text: "Assisted categorisation" },
					{ icon: Users, text: "Household mode" },
				]}
			/>,
		);

		expect(html).toContain("<h2");
		expect(html).toContain("What is envelope budgeting?");
		expect(html).toMatch(/<p class="[^"]*max-w-\[65ch\][^"]*">Give every euro a job\.<\/p>/);
		expect(html).toContain("lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]");
		expect(html.match(/<li /g)).toHaveLength(2);
		expect(html.match(/<svg[^>]*aria-hidden="true"/g)).toHaveLength(2);
		expect(html).toContain("Budgeting features");
	});

	it("puts a preview in the wide column and the points under the text", () => {
		const html = renderToString(
			<FeatureExplainer
				title="Features"
				points={[{ icon: Sparkles, text: "Assisted categorisation" }]}
				visual={<div data-testid="preview">preview</div>}
			/>,
		);

		expect(html.indexOf("Assisted categorisation")).toBeLessThan(html.indexOf('data-testid="preview"'));
	});

	it("spans the last cell of an odd two-column list across both columns", () => {
		const html = renderToString(
			<FeatureExplainer
				title="Features"
				points={[
					{ icon: Sparkles, text: "One" },
					{ icon: Sparkles, text: "Two" },
					{ icon: Sparkles, text: "Three" },
				]}
			/>,
		);

		expect(html.match(/sm:col-span-2/g)).toHaveLength(1);
	});
});

describe("feature pages", () => {
	it("covers every feature route", () => {
		expect(Object.keys(FEATURE_PAGES).sort()).toEqual([...FEATURE_ROUTE_IDS].sort());
	});

	for (const routeId of FEATURE_ROUTE_IDS) {
		it(`${routeId} explains itself with an icon list in every locale, not a lone narrow paragraph`, () => {
			const Page = FEATURE_PAGES[routeId];
			for (const locale of SUPPORTED_LANGS) {
				const html = renderToString(<Page locale={locale} />);
				const sections = explainerSections(html);

				expect(sections.length, `${routeId} (${locale})`).toBeGreaterThan(0);
				for (const section of sections) {
					expect(section).toMatch(/<li /);
					// A translation key left as the text means the strings are missing.
					expect(section).not.toMatch(/>lp\.[a-zA-Z.]+\d*</);
				}
				expect(html).not.toContain("max-w-[60ch]");
			}
		});
	}
});

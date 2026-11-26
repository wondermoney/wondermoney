import { featureFaq } from "@/lib/faq";
import type { FeatureRouteId } from "@/lib/pageStaticPaths";
import { useTranslations } from "@/lib/reactTranslations";

/**
 * A feature page's FAQ: its three questions, always open. `FeaturePage.astro` builds the page's
 * FAQPage JSON-LD from the same `featureFaq` entries.
 */
export default function FeatureFaq({ routeId }: { routeId: FeatureRouteId }) {
	const { locale, t } = useTranslations();

	return (
		<section className="bg-paper-2 py-16 md:py-20">
			<div className="mx-auto max-w-4xl px-6 lg:px-8">
				<h2 className="mb-10 text-center text-3xl font-semibold tracking-tight text-foreground">
					{t(`lp.${routeId}.faqTitle`)}
				</h2>
				<div className="grid gap-4">
					{featureFaq(locale, routeId).map(({ question, answer }) => (
						<div key={question} className="rounded-card border border-border bg-background p-5">
							<h3 className="text-base font-semibold text-foreground">{question}</h3>
							<p className="mt-2 text-sm leading-6 text-muted-foreground">{answer}</p>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

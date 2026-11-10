import { useTranslations } from "@/lib/reactTranslations";
import type { LucideIcon } from "lucide-react";

/**
 * A single third-party research finding, with its source named on screen.
 *
 * This is authority proof, not social proof. WonderMoney has no user count,
 * rating or testimonial volume worth showing yet, and inventing one in a
 * regulated category is both a reputational and a legal risk. What it can
 * borrow is somebody else's audited number — provided the page says whose it
 * is, which is what `sourceKey` is for and why it is not optional.
 *
 * Deliberately quiet: one line of body text and a smaller source line, no
 * card, no big numeral. A stat styled as a hero metric reads as a claim about
 * WonderMoney; styled as a footnote it reads as what it is, a citation.
 */
export default function ResearchNote({
	icon: Icon,
	noteKey,
	sourceKey,
}: {
	icon: LucideIcon;
	noteKey: string;
	sourceKey: string;
}) {
	const { t } = useTranslations();

	return (
		<div className="mx-auto flex max-w-3xl items-start gap-4 rounded-card border border-border bg-paper-2/50 px-6 py-5">
			<Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
			<div className="min-w-0">
				<p className="text-sm leading-6 text-foreground">{t(noteKey)}</p>
				<p className="mt-2 text-xs leading-5 text-muted-foreground">
					{t(sourceKey)}
				</p>
			</div>
		</div>
	);
}

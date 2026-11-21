import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type FeaturePoint = {
	icon: LucideIcon;
	text: string;
	/** A bold first line over `text`, for points that carry a sentence of their own. */
	title?: string;
};

type Props = {
	title: string;
	/** One paragraph per string, each held to a reading width. */
	body?: string | ReadonlyArray<string>;
	points: ReadonlyArray<FeaturePoint>;
	/** Heading over the points panel. */
	pointsTitle?: string;
	/**
	 * A product preview for the wide column. With one, the points move under the
	 * text; without one, the points panel takes the wide column.
	 */
	visual?: ReactNode;
	/** Extra content under the body, such as a research note. */
	children?: ReactNode;
	tone?: "plain" | "muted";
	/** Puts the text on the right from `lg`, to alternate with the section above. */
	reverse?: boolean;
	columns?: 1 | 2;
};

/**
 * The explanatory section of a feature page: the heading and its paragraph on
 * the narrow side, held near 65ch, beside the points as an icon list or beside
 * a product preview. Below `lg` the two stack. Shared by every page in
 * `FEATURE_ROUTE_IDS` so the feature pages keep one shape.
 */
export default function FeatureExplainer({
	title,
	body,
	points,
	pointsTitle,
	visual,
	children,
	tone = "plain",
	reverse = false,
	columns = 2,
}: Props) {
	const paragraphs = body === undefined ? [] : typeof body === "string" ? [body] : body;

	return (
		<section data-feature-explainer="" className={cn("py-16 md:py-20", tone === "muted" && "bg-paper-2")}>
			<div className="mx-auto max-w-6xl px-6 lg:px-8">
				{/* The text column stays 5 parts wide on whichever side it sits. */}
				<div
					className={cn(
						"grid gap-10 lg:items-start lg:gap-16",
						reverse ? "lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]" : "lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]",
					)}
				>
					<div className={cn("min-w-0", reverse && "lg:order-2")}>
						<h2 className="text-3xl font-semibold tracking-tight text-foreground [text-wrap:balance]">{title}</h2>
						{paragraphs.map((paragraph) => (
							<p key={paragraph} className="mt-5 max-w-[65ch] text-base leading-7 text-ink-2">
								{paragraph}
							</p>
						))}
						{children}
						{visual ? (
							<div className="mt-8">
								<FeaturePointList points={points} title={pointsTitle} columns={1} />
							</div>
						) : null}
					</div>
					<div className={cn("min-w-0", reverse && "lg:order-1")}>
						{visual ?? <FeaturePointList points={points} title={pointsTitle} columns={columns} />}
					</div>
				</div>
			</div>
		</section>
	);
}

function FeaturePointList({
	points,
	title,
	columns,
}: {
	points: ReadonlyArray<FeaturePoint>;
	title?: string;
	columns: 1 | 2;
}) {
	const twoColumns = columns === 2 && points.length > 1;

	return (
		<div className="overflow-hidden rounded-card border border-border bg-card">
			{title ? (
				<h3 className="border-b border-border px-5 py-4 text-base font-semibold text-foreground sm:px-6">{title}</h3>
			) : null}
			{/* The 1px gaps over the border colour draw the hairlines between the cells. */}
			<ul className={cn("grid gap-px bg-border", twoColumns && "sm:grid-cols-2")}>
				{points.map(({ icon: Icon, text, title: pointTitle }, index) => (
					<li
						key={pointTitle ?? text}
						className={cn(
							"flex items-start gap-4 bg-card p-5 sm:px-6",
							twoColumns && points.length % 2 === 1 && index === points.length - 1 && "sm:col-span-2",
						)}
					>
						<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-paper-2 text-primary">
							<Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
						</span>
						<div className="min-w-0 pt-1.5">
							{pointTitle ? (
								<>
									<p className="text-sm font-semibold leading-6 text-foreground">{pointTitle}</p>
									<p className="mt-1 text-sm leading-6 text-ink-2">{text}</p>
								</>
							) : (
								<p className="text-sm leading-6 text-foreground">{text}</p>
							)}
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}

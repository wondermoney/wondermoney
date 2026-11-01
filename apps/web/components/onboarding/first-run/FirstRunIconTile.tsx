import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Subtle, category-style icon tile used across the first-run onboarding.
 * Mirrors components/ui/CategoryIcon.tsx: neutral muted square with a single
 * colored glyph. Colour communicates domain, it never decorates.
 *
 * These tones are *categories*, not status, so they do not map onto
 * `--success` / `--warning` / `--destructive`: a green tile beside "track your
 * net worth" is a domain tint, and painting it with the success token would
 * assert a state the screen is not reporting. The system's only categorical
 * colour vocabulary is the chart ramp (DESIGN.md § 2, "The chart ramp"), which
 * is hue-fixed per slot across both themes and already validated as a
 * categorical palette — so that is what a category tint uses.
 *
 * There is deliberately no `blue` or `amber` tone:
 *
 * - `blue` has no honest token. The system carries exactly one non-brand blue
 *   (`--chart-5`, sky 235); a second one does not exist, because the ramp's
 *   adjacent-CVD separation is what stops two blues coexisting. Use `sky`.
 *   Duplicate tones are normal here — the goal list assigns `violet` twice.
 * - The only amber the system owns is `--warning`, which would read as "this
 *   needs attention" on a tile that means nothing of the sort.
 *
 * `rose` survives because its one consumer (the credit-card row of the mock
 * dashboard) marks a *negative balance*, which is what `--destructive-text`
 * is for. `--chart-4` (the categorical vermillion) was measured first and
 * rejected: 2.72:1 on `bg-muted` in dark mode, under the 3:1 floor a glyph owes
 * WCAG 1.4.11.
 *
 * Measured on `bg-muted`, light / dark: primary 6.44 / 5.17, muted-foreground
 * 4.85 / 5.83, chart-5 4.45 / 3.65, chart-3 4.92 / 4.48, destructive-text
 * 5.36 / 4.83. The raw ramps these replaced were below the floor in light mode
 * on three of five tones (sky 2.48, green 2.26, amber 1.96).
 */
export type FirstRunIconTone = "violet" | "sky" | "green" | "slate" | "rose";

const toneClass: Record<FirstRunIconTone, string> = {
  violet: "text-primary",
  sky: "text-chart-5",
  green: "text-chart-3",
  slate: "text-muted-foreground",
  rose: "text-destructive-text",
};

export default function FirstRunIconTile({
  icon: Icon,
  tone = "slate",
  size = "md",
  className,
}: {
  icon: LucideIcon;
  tone?: FirstRunIconTone;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "bg-muted inline-flex shrink-0 items-center justify-center rounded-lg",
        size === "sm" ? "size-8" : "size-9",
        className,
      )}
      aria-hidden
    >
      <Icon
        className={cn(size === "sm" ? "size-4" : "size-[18px]", toneClass[tone])}
        strokeWidth={2}
      />
    </span>
  );
}

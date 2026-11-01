import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Headline + supporting copy, shared by every first-run step. There is no
 * kicker above the headline: it repeated the step name the progress line
 * already shows, as tracked capitals.
 */
export function FirstRunStepIntro({
  headline,
  sub,
  className,
}: {
  headline: string;
  sub?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2.5", className)}>
      <h1 className="text-foreground max-w-xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
        {headline}
      </h1>
      {sub ? (
        <p className="text-muted-foreground max-w-prose text-sm leading-6 sm:text-base">
          {sub}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Keep the first-run flow focused: one readable column and one decision at a time.
 * The preview argument remains accepted so step-specific integrations do not need
 * to coordinate layout concerns with the shell.
 */
export function FirstRunSplit({
  copy,
  preview,
}: {
  copy: ReactNode;
  preview: ReactNode;
}) {
  void preview;
  return <div className="mx-auto w-full max-w-2xl">{copy}</div>;
}

/** Narrow, centered column for the copy-only steps (goals, privacy, done). */
export function FirstRunCentered({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-2xl">{children}</div>;
}

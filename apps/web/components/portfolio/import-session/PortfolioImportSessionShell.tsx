"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef } from "react";

import type { PortfolioImportStep } from "@/lib/portfolio/import-session-flow";

import { PortfolioImportStepper } from "./PortfolioImportStepper";

interface PortfolioImportSessionShellProps {
  children: ReactNode;
  currentStep: PortfolioImportStep;
  fileName?: string;
  footer?: ReactNode;
}

export function PortfolioImportSessionShell({
  children,
  currentStep,
  fileName,
  footer,
}: PortfolioImportSessionShellProps) {
  const t = useTranslations();
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const nextHeading = document.querySelector<HTMLElement>(
      '[data-portfolio-import-step-heading="true"]',
    );

    if (!nextHeading) return;

    nextHeading.setAttribute("tabindex", "-1");
    nextHeading.focus();
  }, [currentStep]);

  const stepAnnouncementKey = (() => {
    switch (currentStep) {
      case "upload":
        return "portfolio-import-step-upload";
      case "analyzing":
        return "portfolio-import-step-analyzing";
      case "columnMapping":
        return "portfolio-import-step-column-mapping";
      case "preview":
        return "portfolio-import-step-preview";
      case "assetReview":
        return "portfolio-import-step-asset-review";
      case "confirm":
        return "portfolio-import-step-confirm";
      default:
        return "portfolio-import-session-title";
    }
  })();

  return (
    <section
      aria-labelledby={titleId}
      className="mx-auto flex min-h-0 w-full flex-1 flex-col gap-3 overflow-hidden"
    >
      <p aria-live="polite" className="sr-only">
        {t(stepAnnouncementKey as never)}
      </p>
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <h2
            id={titleId}
            ref={headingRef}
            className="text-foreground text-xl font-semibold tracking-tight sm:text-2xl"
          >
            {t("portfolio-import-session-title")}
          </h2>
          <p className="text-muted-foreground max-w-2xl text-sm leading-6">
            {t("portfolio-import-session-description")}
          </p>
          {fileName ? (
            <div className="text-muted-foreground mt-1 flex min-w-0 items-center gap-2 text-xs">
              <span>{t("portfolio-import-file-label")}</span>
              <span className="text-foreground min-w-0 truncate font-mono tabular-nums">
                {fileName}
              </span>
            </div>
          ) : null}
        </div>

        <PortfolioImportStepper currentStep={currentStep} />
      </header>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-0 py-0 pr-1 shadow-none">
        {children}
      </div>

      {footer ? (
        <div className="bg-background sticky bottom-0 z-10 -mx-4 border-t px-4 py-4 sm:-mx-6 sm:px-6">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

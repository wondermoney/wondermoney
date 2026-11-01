"use client";

import { useTranslations } from "next-intl";

import {
  getPortfolioImportPhase,
  getPortfolioImportPhaseLabelKey,
  type PortfolioImportPhase,
  type PortfolioImportStep,
} from "@/lib/portfolio/import-session-flow";
import { cn } from "@/lib/utils";

interface PortfolioImportStepperProps {
  currentStep: PortfolioImportStep;
}

const PHASES: PortfolioImportPhase[] = ["upload", "review", "import"];

export function PortfolioImportStepper({
  currentStep,
}: PortfolioImportStepperProps) {
  const t = useTranslations();
  const currentPhase = getPortfolioImportPhase(currentStep);
  const activeIndex = PHASES.indexOf(currentPhase);

  return (
    <nav
      aria-label={t("portfolio-import-session-title")}
      className="px-0 py-0"
    >
      <ol className="grid grid-cols-3 gap-1">
        {PHASES.map((phase, index) => {
          const isActive = index === activeIndex;
          const isComplete = index < activeIndex;

          return (
            <li
              key={phase}
              aria-current={isActive ? "step" : undefined}
              className="min-w-0"
            >
              <div className="flex min-w-0 items-center gap-2 px-1 py-0.5">
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium tabular-nums transition-colors",
                    isActive &&
                      "border-primary bg-primary text-primary-foreground",
                    isComplete &&
                      !isActive &&
                      "border-border bg-background text-foreground",
                    !isActive &&
                      !isComplete &&
                      "border-border bg-background text-muted-foreground",
                  )}
                >
                  {index + 1}
                </span>
                <span
                  className={cn(
                    "text-muted-foreground truncate text-xs",
                    isActive && "text-foreground font-medium",
                  )}
                >
                  {t(getPortfolioImportPhaseLabelKey(phase) as never)}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { type KeyboardEvent, useRef } from "react";

import { cn } from "@/lib/utils";

/** What the person is importing: a trade history, the positions held today, or manual assets. */
export type PortfolioImportMode = "trades" | "positions" | "manualAssets";

const MODES: { mode: PortfolioImportMode; labelKey: string; descriptionKey: string }[] = [
  {
    mode: "trades",
    labelKey: "portfolio-import-mode-trades",
    descriptionKey: "portfolio-import-mode-trades-description",
  },
  {
    mode: "positions",
    labelKey: "portfolio-import-mode-positions",
    descriptionKey: "portfolio-import-mode-positions-description",
  },
  {
    mode: "manualAssets",
    labelKey: "portfolio-import-mode-manual-assets",
    descriptionKey: "portfolio-import-mode-manual-assets-description",
  },
];

interface PortfolioImportModeSelectorProps {
  disabled?: boolean;
  onChange: (mode: PortfolioImportMode) => void;
  value: PortfolioImportMode;
}

/** A radio group of the three import modes, each with a line on what its file holds. */
export function PortfolioImportModeSelector({
  disabled = false,
  onChange,
  value,
}: PortfolioImportModeSelectorProps) {
  const t = useTranslations();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + MODES.length) % MODES.length;
    onChange(MODES[next].mode);
    buttons.current[next]?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <div id="portfolio-import-mode-label" className="text-foreground text-sm font-medium">
        {t("portfolio-import-mode-label")}
      </div>
      <div
        role="radiogroup"
        aria-labelledby="portfolio-import-mode-label"
        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
      >
        {MODES.map((option, index) => {
          const checked = option.mode === value;
          return (
            <button
              key={option.mode}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(option.mode)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "flex min-h-11 flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden disabled:opacity-50",
                checked ? "border-primary bg-primary/5" : "hover:bg-muted/50",
              )}
            >
              <span className="text-foreground text-sm font-medium">{t(option.labelKey)}</span>
              <span className="text-muted-foreground text-xs leading-5">{t(option.descriptionKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

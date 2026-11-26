"use client";

import { ChevronRight, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface NoAccountOption {
  key: string;
  icon: LucideIcon;
  label: string;
  hint?: string;
  onSelect: () => void;
}

/**
 * The ways to start without a linked bank, as one list: an icon, a name and at most one
 * short line each, inside a single hairline container with dividers between the rows
 * (DESIGN.md, the No-Nesting Rule), not a row of separate boxes. Mobile draws the same
 * list (`features/accounts/no-account-options.tsx`).
 */
export function NoAccountOptionList({
  options,
  className,
}: {
  options: readonly NoAccountOption[];
  className?: string;
}) {
  return (
    <ul
      className={cn(
        "border-border divide-border divide-y overflow-hidden rounded-lg border",
        className,
      )}
    >
      {options.map((option) => (
        <li key={option.key}>
          <button
            type="button"
            onClick={option.onSelect}
            className="hover:bg-muted/50 focus-visible:ring-ring active:bg-muted/70 flex min-h-11 w-full items-center gap-3 px-3 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
          >
            <span
              aria-hidden
              className="bg-muted inline-flex size-8 shrink-0 items-center justify-center rounded-lg"
            >
              <option.icon className="text-muted-foreground size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-foreground block text-sm font-medium">
                {option.label}
              </span>
              {option.hint ? (
                <span className="text-muted-foreground block text-xs leading-5">
                  {option.hint}
                </span>
              ) : null}
            </span>
            <ChevronRight
              aria-hidden
              className="text-muted-foreground size-4 shrink-0"
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

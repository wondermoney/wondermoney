"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * An applied filter, shown and removable in place.
 *
 * DESIGN.md § 9. The reference keeps filters visible beside the data —
 * `Date & Time`, `Amount`, `Currency`, `Status` — rather than behind a
 * control that only reports how many there are.
 *
 * This app showed a count badge on the Filters button: "3". Which three, and
 * whether the empty table in front of you is the truth or a filter you forgot,
 * required opening the sheet to find out. A chip per applied filter answers
 * both without a click, and its ✕ removes that one filter without touching
 * the others.
 *
 * The label names the *dimension* and the value names the selection, because
 * "Groceries" alone does not say whether it is a category or a merchant.
 */
export interface FilterChipProps {
  /** The dimension — "Category", "Account". */
  label: string;
  /** The selection — "Groceries", "2 selected". */
  value: ReactNode;
  /** Removes this filter alone. */
  onRemove: () => void;
  /** Accessible name for the remove control, e.g. "Remove category filter". */
  removeLabel: string;
  className?: string;
}

export function FilterChip({
  label,
  value,
  onRemove,
  removeLabel,
  className,
}: FilterChipProps) {
  return (
    <span
      className={cn(
        "border-border bg-card text-foreground inline-flex max-w-full items-center gap-1.5 rounded-full border py-1 pr-1 pl-2.5 text-xs",
        className,
      )}
    >
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="truncate font-medium">{value}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className={cn(
          "text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring flex size-5 shrink-0 items-center justify-center rounded-full",
          "transition-[color,background-color] duration-[var(--duration-micro)] ease-out",
          "focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-hidden",
          "motion-reduce:transition-none",
        )}
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </span>
  );
}

/** The row the chips live in. Wraps; renders nothing when empty. */
export function FilterChipBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {children}
    </div>
  );
}

export default FilterChip;

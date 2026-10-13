"use client";

import type { ReactNode } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * A detail panel that opens *over* a list, without navigating away.
 *
 * DESIGN.md § 9. The reference inspects a row in place: an object-type
 * eyebrow, a title with its status inline, a subtitle, actions, and a property
 * list — all beside the table you were reading, so the list keeps its scroll
 * position, its filters and its place in your head.
 *
 * The alternative this replaces is pushing a route for every row, which costs
 * a full page load and loses the list on the way back.
 *
 * Built on `Sheet`, so it inherits focus trapping, Escape-to-close and the
 * scrim. Below `sm` the sheet is full width, which is the mobile answer to the
 * same problem — the § 9 spec's "full-height sheet below md".
 */
export interface InspectorDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The kind of thing being inspected — "Transaction". Sits above the title. */
  objectType?: string;
  /** The identity. For an object with no name, this is its key figure. */
  title: ReactNode;
  /** Status chips, inline with the title. */
  badges?: ReactNode;
  /** A line under the title — merchant, description. */
  subtitle?: ReactNode;
  /** Primary and secondary actions. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function InspectorDrawer({
  open,
  onOpenChange,
  objectType,
  title,
  badges,
  subtitle,
  actions,
  children,
  className,
}: InspectorDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn("flex w-full flex-col gap-0 sm:max-w-md", className)}
      >
        <SheetHeader className="space-y-2 pb-4">
          {objectType ? (
            <p className="text-muted-foreground text-xs">{objectType}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="text-xl font-semibold tracking-tight">
              {title}
            </SheetTitle>
            {badges}
          </div>
          {subtitle ? (
            <SheetDescription className="text-sm">{subtitle}</SheetDescription>
          ) : null}
          {actions ? (
            <div className="flex flex-wrap gap-2 pt-1">{actions}</div>
          ) : null}
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * A label/value list — the drawer's body.
 *
 * Values are right-aligned against left-aligned muted labels so a column of
 * them scans, and each row wraps rather than truncating: in a 448px panel a
 * long merchant name or an IBAN needs the second line more than it needs to
 * stay on one.
 */
export function PropertyList({
  items,
  className,
}: {
  items: { key: string; label: ReactNode; value: ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn("divide-border divide-y", className)}>
      {items.map((item) => (
        <div
          key={item.key}
          className="flex items-start justify-between gap-4 py-2.5"
        >
          <dt className="text-muted-foreground shrink-0 text-sm">
            {item.label}
          </dt>
          <dd className="min-w-0 text-right text-sm break-words">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default InspectorDrawer;

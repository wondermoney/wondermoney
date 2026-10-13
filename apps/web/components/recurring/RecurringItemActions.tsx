"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { RecurringItem } from "@/lib/api/recurring/useRecurringItems";

type Props = {
  status: RecurringItem["status"];
  recurringSeriesKey: number;
  pending: boolean;
  confirmLabel?: ReactNode;
  dismissLabel?: ReactNode;
  markNotRecurringLabel?: ReactNode;
  restoreLabel?: ReactNode;
  confirmAriaLabel?: string;
  dismissAriaLabel?: string;
  markNotRecurringAriaLabel?: string;
  restoreAriaLabel?: string;
  onConfirm?: (recurringSeriesKey: number) => void | Promise<void>;
  onDismiss?: (recurringSeriesKey: number) => void | Promise<void>;
  onRestore?: (recurringSeriesKey: number) => void | Promise<void>;
};

export function RecurringItemActions({
  status,
  recurringSeriesKey,
  pending,
  confirmLabel,
  dismissLabel,
  markNotRecurringLabel,
  restoreLabel,
  confirmAriaLabel,
  dismissAriaLabel,
  markNotRecurringAriaLabel,
  restoreAriaLabel,
  onConfirm,
  onDismiss,
  onRestore,
}: Props) {
  if (status === "dismissed") {
    return onRestore && restoreLabel ? (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="min-h-11 2xl:min-h-9"
        aria-label={restoreAriaLabel}
        onClick={() => onRestore(recurringSeriesKey)}
        disabled={pending}
      >
        {restoreLabel}
      </Button>
    ) : null;
  }

  if (status === "confirmed") {
    return onDismiss && markNotRecurringLabel ? (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="min-h-11 2xl:min-h-9"
        aria-label={markNotRecurringAriaLabel}
        onClick={() => onDismiss(recurringSeriesKey)}
        disabled={pending}
      >
        {markNotRecurringLabel}
      </Button>
    ) : null;
  }

  if (status !== "candidate") return null;

  return (
    <>
      {onConfirm && confirmLabel ? (
        <Button
          type="button"
          size="sm"
          className="min-h-11 2xl:min-h-9"
          aria-label={confirmAriaLabel}
          onClick={() => onConfirm(recurringSeriesKey)}
          disabled={pending}
        >
          {confirmLabel}
        </Button>
      ) : null}
      {onDismiss && dismissLabel ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-11 2xl:min-h-9"
          aria-label={dismissAriaLabel}
          onClick={() => onDismiss(recurringSeriesKey)}
          disabled={pending}
        >
          {dismissLabel}
        </Button>
      ) : null}
    </>
  );
}

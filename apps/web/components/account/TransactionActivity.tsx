"use client";

import { formatDistanceToNow } from "date-fns";
import {
  ArrowRightLeft,
  Ban,
  CircleAlert,
  Copy,
  Pencil,
  Plus,
  Scale,
  Tag,
  Trash2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ComponentType } from "react";

import useTransactionHistory, {
  type TransactionAuditActorType,
  type TransactionAuditEventType,
  type TransactionHistoryEntry,
} from "@/lib/api/account/useTransactionHistory";
import { getDateFnsLocale } from "@/lib/utils/dateFnsLocale";

const EVENT_CONFIG: Record<
  TransactionAuditEventType,
  { icon: ComponentType<{ className?: string }>; labelKey: string }
> = {
  balance_recalc: { icon: Scale, labelKey: "transaction-activity-balance" },
  categorized: { icon: Tag, labelKey: "transaction-activity-recategorized" },
  created: { icon: Plus, labelKey: "transaction-activity-created" },
  dedup_skipped: { icon: Copy, labelKey: "transaction-activity-deduped" },
  pending_expired: { icon: Ban, labelKey: "transaction-activity-expired" },
  pending_promoted: {
    icon: ArrowRightLeft,
    labelKey: "transaction-activity-promoted",
  },
  soft_deleted: { icon: Trash2, labelKey: "transaction-activity-deleted" },
  system_edit: { icon: Pencil, labelKey: "transaction-activity-updated" },
  user_edit: { icon: Pencil, labelKey: "transaction-activity-edited" },
};

function actorKey(actorType: TransactionAuditActorType): string {
  return actorType === "user"
    ? "transaction-activity-by-you"
    : "transaction-activity-automatic";
}

/**
 * Per-transaction activity log (RAD-346) — the antidote to "my edits disappeared". Shows created /
 * recategorized / edited / promoted-from-pending / expired, with who and when.
 */
export default function TransactionActivity({
  transactionId,
}: {
  transactionId: number;
}) {
  const t = useTranslations();
  const { data, isLoading, isError } = useTransactionHistory(transactionId);

  return (
    <section aria-label={t("transaction-activity-title")} className="mt-2">
      <h3 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
        {t("transaction-activity-title")}
      </h3>
      {isLoading ? (
        <div
          className="space-y-2"
          aria-busy="true"
          aria-label={t("transaction-activity-title")}
        >
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="bg-muted h-6 animate-pulse rounded" />
          ))}
        </div>
      ) : isError ? (
        <p className="text-muted-foreground text-xs">
          {t("transaction-activity-empty")}
        </p>
      ) : !data || data.history.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {t("transaction-activity-empty")}
        </p>
      ) : (
        <ol role="list" className="space-y-2.5">
          {data.history.map((entry) => (
            <ActivityRow key={entry.transactionAuditLogKey} entry={entry} />
          ))}
        </ol>
      )}
    </section>
  );
}

function ActivityRow({ entry }: { entry: TransactionHistoryEntry }) {
  const t = useTranslations();
  const locale = useLocale();
  const config = EVENT_CONFIG[entry.eventType];
  const Icon = config?.icon ?? CircleAlert;
  const label = config ? t(config.labelKey) : entry.eventType;

  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span className="bg-muted text-muted-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full">
        <Icon className="size-3" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-foreground leading-tight">
          {label}{" "}
          <span className="text-muted-foreground">
            {t(actorKey(entry.actorType))}
          </span>
        </p>
        <time
          dateTime={entry.createdAt}
          className="text-muted-foreground text-xs"
        >
          {formatDistanceToNow(new Date(entry.createdAt), {
            addSuffix: true,
            locale: getDateFnsLocale(locale),
          })}
        </time>
      </div>
    </li>
  );
}

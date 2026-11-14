"use client";

import { Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Amount } from "@/components/ui/Amount";
import { badgeVariants } from "@/components/ui/badge";
import {
  linkedTransactionTitle,
  otherSideOf,
  reimbursementBadgeKind,
} from "@/lib/account/transaction-reimbursement";
import type { LinkedTransaction } from "@/lib/api/account/useTransactionReimbursements";
import type { Transaction } from "@/lib/api/account/useTransactions";
import { cn } from "@/lib/utils";
import { transactionDisplayDate } from "@/lib/utils/transaction-date";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

/** "Current account · 3 Oct": where and when a linked transaction happened. */
export function useLinkedTransactionMeta() {
  const formatShortDate = useFormatShortDate();
  return (transaction: LinkedTransaction) =>
    [
      transaction.accountName,
      transaction.transactionDate
        ? formatShortDate(transactionDisplayDate(transaction.transactionDate))
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
}

/** A linked transaction's title and where/when, as one block. */
export function LinkedTransactionSummary({
  transaction,
  extra,
}: {
  transaction: LinkedTransaction;
  /** A further muted fact, after where and when. */
  extra?: string | null;
}) {
  const meta = useLinkedTransactionMeta();
  const title = linkedTransactionTitle(transaction);
  return (
    <div className="min-w-0 space-y-0.5 text-left">
      <p
        className={cn(
          "truncate text-sm",
          title ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {title ?? "—"}
      </p>
      <p className="text-muted-foreground truncate text-xs">
        {[meta(transaction), extra].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

interface BadgeProps {
  transaction: Transaction;
  /** One link: open the transaction at its other end. */
  onOpenLinked: (transactionKey: number) => void;
  /** Several links: show this row with the list of them. */
  onShowLinks: () => void;
  className?: string;
}

/**
 * The row's "Reimbursed" / "Partly reimbursed" / "Reimbursement" badge. It is a button: with one
 * link it opens the other transaction, with several it shows the list. Clicking it does not
 * also open the row.
 */
export function TransactionReimbursementBadge({
  transaction,
  onOpenLinked,
  onShowLinks,
  className,
}: BadgeProps) {
  const t = useTranslations("transactionReimbursement");
  const kind = reimbursementBadgeKind(transaction);
  const links = transaction.reimbursements ?? [];
  if (!kind) return null;

  const label = t(`badge.${kind}`);
  const single =
    links.length === 1
      ? otherSideOf(links[0]!, transaction.transactionKey)
      : null;
  return (
    <button
      type="button"
      aria-label={
        single
          ? t("badge-open-label", {
              label,
              name: linkedTransactionTitle(single) ?? "—",
            })
          : t("badge-list-label", { label, count: links.length })
      }
      className={cn(
        badgeVariants({ variant: "secondary" }),
        "text-muted-foreground hover:text-foreground h-5 shrink-0 gap-1 rounded-full px-2 text-xs font-normal",
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        if (single) onOpenLinked(single.transactionKey);
        else onShowLinks();
      }}
    >
      <Undo2 className="size-3" aria-hidden />
      {label}
    </button>
  );
}

/**
 * A row's links, for its inspector: the transaction at the other end of each, with the linked
 * amount. One that is loaded in the list opens; one that is not (another page, another
 * filter) is only described.
 */
export function TransactionReimbursementLinksList({
  transaction,
  canOpen,
  onOpenLinked,
}: {
  transaction: Pick<Transaction, "transactionKey" | "reimbursements">;
  canOpen: (transactionKey: number) => boolean;
  onOpenLinked: (transactionKey: number) => void;
}) {
  const t = useTranslations("transactionReimbursement");
  const links = transaction.reimbursements ?? [];
  if (links.length === 0) return null;
  return (
    <section className="border-border mt-2 border-t pt-3">
      <h3 className="text-muted-foreground text-sm">{t("links")}</h3>
      <ul className="divide-border divide-y">
        {links.map((link) => {
          const other = otherSideOf(link, transaction.transactionKey);
          const content = (
            <>
              <LinkedTransactionSummary transaction={other} />
              <Amount
                value={link.amount}
                currency={link.currencyCode}
                className="shrink-0 font-mono text-sm"
              />
            </>
          );
          return (
            <li key={link.transactionReimbursementKey}>
              {canOpen(other.transactionKey) ? (
                <button
                  type="button"
                  aria-label={t("open-label", {
                    name: linkedTransactionTitle(other) ?? "—",
                  })}
                  className="hover:bg-accent focus-visible:ring-ring flex w-full items-start justify-between gap-3 rounded-sm px-1 py-2 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  onClick={() => onOpenLinked(other.transactionKey)}
                >
                  {content}
                </button>
              ) : (
                <div className="flex items-start justify-between gap-3 px-1 py-2">
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

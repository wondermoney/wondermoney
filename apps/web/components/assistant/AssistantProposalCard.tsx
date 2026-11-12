"use client";

import { ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  AssistantProposal,
  AssistantProposalChange,
  AssistantProposalStatus,
} from "@/lib/api/assistant/types";
import {
  useApplyAssistantProposal,
  useRejectAssistantProposal,
} from "@/lib/api/assistant/useDecideAssistantProposal";
import {
  API_ERROR_CODE,
  getApiErrorCode,
  isDemoReadOnlyError,
} from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { formatShortDateForLocale } from "@/lib/utils/formatDate";

/** How many diff rows show before "Show all". A proposal can carry up to 100. */
const COLLAPSED_ROWS = 5;

type Props = {
  className?: string;
  /** Show where the proposal came from (the settings list mixes both sources). */
  showSource?: boolean;
  proposal: AssistantProposal;
};

/** A decided state the card shows instead of its buttons. */
type Outcome = Exclude<AssistantProposalStatus, "pending"> | "notPending";

/** The state a 409 from apply/reject means; anything else keeps the buttons. */
function outcomeOfError(error: unknown): Outcome | null {
  switch (getApiErrorCode(error)) {
    case API_ERROR_CODE.ASSISTANT_PROPOSAL_EXPIRED:
      return "expired";
    case API_ERROR_CODE.ASSISTANT_PROPOSAL_FAILED:
      return "failed";
    case API_ERROR_CODE.ASSISTANT_PROPOSAL_NOT_PENDING:
      return "notPending";
    default:
      return null;
  }
}

/** A pending proposal past its seven days reads as expired before the job marks it. */
function initialOutcome(proposal: AssistantProposal): Outcome | null {
  if (proposal.status !== "pending") return proposal.status;
  return new Date(proposal.expiresAt).getTime() <= Date.now()
    ? "expired"
    : null;
}

/**
 * A change the assistant or an MCP client proposed, with a before -> after diff
 * and Apply / Dismiss. Nothing is written until the person applies it.
 */
export default function AssistantProposalCard({
  className,
  proposal,
  showSource = false,
}: Props) {
  const t = useTranslations("assistant.proposals");
  const locale = useLocale();
  const apply = useApplyAssistantProposal();
  const reject = useRejectAssistantProposal();
  const [outcome, setOutcome] = useState<Outcome | null>(() =>
    initialOutcome(proposal),
  );
  const [errorKey, setErrorKey] = useState<"error" | "demoReadOnly" | null>(
    null,
  );
  const [expanded, setExpanded] = useState(false);

  const isBusy = apply.isPending || reject.isPending;
  const count = proposal.changes.length + proposal.unavailableCount;
  const rows = expanded
    ? proposal.changes
    : proposal.changes.slice(0, COLLAPSED_ROWS);
  const hiddenRows = proposal.changes.length - rows.length;

  async function decide(decision: "apply" | "reject") {
    setErrorKey(null);
    try {
      const decided = await (decision === "apply" ? apply : reject).mutateAsync(
        proposal.id,
      );
      setOutcome(decided.status === "pending" ? null : decided.status);
    } catch (error) {
      const fromError = outcomeOfError(error);
      if (fromError) {
        setOutcome(fromError);
      } else {
        setErrorKey(isDemoReadOnlyError(error) ? "demoReadOnly" : "error");
      }
    }
  }

  return (
    <section
      aria-label={title(proposal, count, t)}
      className={cn(
        "border-border/70 bg-background rounded-lg border p-4",
        className,
      )}
      data-testid="assistant-proposal-card"
    >
      <div className="space-y-1">
        <p className="text-foreground text-sm font-medium">
          {title(proposal, count, t)}
        </p>
        <p className="text-muted-foreground text-xs leading-5">
          {showSource
            ? `${t(proposal.source === "mcp" ? "sourceMcp" : "sourceAssistant")} · `
            : ""}
          {t("expires", {
            date: formatShortDateForLocale(proposal.expiresAt, locale),
          })}
        </p>
      </div>

      {rows.length > 0 ? (
        <ul className="divide-border/60 mt-3 divide-y text-sm">
          {rows.map((change) => (
            <li
              key={`${change.transactionId}-${change.field}`}
              className="space-y-1 py-2 first:pt-0 last:pb-0"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-foreground min-w-0 truncate">
                  {change.description ?? t("noDescription")}
                </span>
                {change.transactionDate ? (
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {formatShortDateForLocale(change.transactionDate, locale)}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground line-through decoration-1">
                  {valueLabel(change, "before", t)}
                </span>
                <ArrowRight
                  aria-label={t("changesTo")}
                  className="text-muted-foreground size-3.5"
                  role="img"
                />
                <span className="text-foreground font-medium">
                  {valueLabel(change, "after", t)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {hiddenRows > 0 ? (
        <Button
          type="button"
          variant="link"
          size="xs"
          className="mt-1 px-0"
          onClick={() => setExpanded(true)}
        >
          {t("showAll", { count: proposal.changes.length })}
        </Button>
      ) : null}

      {proposal.unavailableCount > 0 ? (
        <p className="text-muted-foreground mt-2 text-xs">
          {t("unavailable", { count: proposal.unavailableCount })}
        </p>
      ) : null}

      <div className="border-border/60 mt-3 border-t pt-3">
        {outcome ? (
          <p
            className={cn(
              "text-sm",
              outcome === "applied"
                ? "text-success-text"
                : outcome === "failed"
                  ? "text-destructive-text"
                  : "text-muted-foreground",
            )}
            data-testid="assistant-proposal-outcome"
            role="status"
          >
            {t(`outcome.${outcome}`)}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={isBusy}
              aria-busy={apply.isPending}
              onClick={() => void decide("apply")}
            >
              {t("apply")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={isBusy}
              aria-busy={reject.isPending}
              onClick={() => void decide("reject")}
            >
              {t("dismiss")}
            </Button>
            <p className="text-muted-foreground text-xs">{t("confirmNote")}</p>
          </div>
        )}
        {errorKey ? (
          <p className="text-destructive-text mt-2 text-sm" role="alert">
            {t(errorKey)}
          </p>
        ) : null}
      </div>
    </section>
  );
}

type Translate = ReturnType<typeof useTranslations>;

function title(proposal: AssistantProposal, count: number, t: Translate) {
  switch (proposal.kind) {
    case "categorize_transactions": {
      const category = proposal.changes.find(
        (change) => typeof change.after === "string",
      )?.after;
      return typeof category === "string"
        ? t("title.categorize", { category, count })
        : t("title.categorizeGeneric", { count });
    }
    case "mark_transactions_reviewed":
      return t("title.markReviewed", { count });
    case "update_transaction_note":
      return t("title.updateNote");
  }
}

function valueLabel(
  change: AssistantProposalChange,
  side: "before" | "after",
  t: Translate,
) {
  const value = change[side];
  switch (change.field) {
    case "category":
      return typeof value === "string" && value ? value : t("uncategorized");
    case "reviewed":
      return value === true ? t("reviewed") : t("notReviewed");
    case "note":
      return typeof value === "string" && value ? value : t("noNote");
  }
}

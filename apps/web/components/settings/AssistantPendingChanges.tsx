"use client";

import { useTranslations } from "next-intl";

import AssistantProposalCard from "@/components/assistant/AssistantProposalCard";
import useAssistantProposals from "@/lib/api/assistant/useAssistantProposals";
import useAiHidden from "@/lib/api/user-preferences/useAiHidden";
import { cn } from "@/lib/utils";

import { Heading, Text } from "../ui/Typography";

/**
 * Settings › Assistant › Pending changes: the proposals waiting for a decision,
 * mostly from MCP clients, which have no chat to show a card in. Gone entirely
 * when the person hid AI; the API refuses these routes then anyway.
 */
export default function AssistantPendingChanges({
  className,
}: {
  /** The tab without assistant settings shows the list alone, with no divider above it. */
  className?: string;
}) {
  const t = useTranslations("assistant.proposals");
  const aiHidden = useAiHidden();
  const { data, isError, isLoading } = useAssistantProposals("pending", {
    enabled: !aiHidden,
  });

  if (aiHidden) return null;

  const proposals = data?.proposals ?? [];

  return (
    <div
      className={cn("border-border/60 space-y-4 border-t pt-6", className)}
      data-testid="assistant-pending-changes"
    >
      <div className="space-y-1">
        <Heading variant="h4">{t("pendingTitle")}</Heading>
        <Text className="text-muted-foreground text-sm">
          {t("pendingDescription")}
        </Text>
      </div>

      {isLoading ? (
        <Text className="text-muted-foreground text-sm">
          {t("pendingLoading")}
        </Text>
      ) : isError ? (
        <Text className="text-destructive-text text-sm">
          {t("pendingError")}
        </Text>
      ) : proposals.length === 0 ? (
        <Text className="text-muted-foreground text-sm">
          {t("pendingEmpty")}
        </Text>
      ) : (
        <div className="space-y-3">
          {proposals.map((proposal) => (
            <AssistantProposalCard
              key={proposal.id}
              proposal={proposal}
              showSource
            />
          ))}
        </div>
      )}
    </div>
  );
}

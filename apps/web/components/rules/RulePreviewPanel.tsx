"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { Amount } from "@/components/ui/Amount";
import { Spinner } from "@/components/ui/Spinner";
import {
  type RuleDraft,
  type RulePreviewChanges,
  useRulePreview,
} from "@/lib/api/rule/useRules";
import type { SummaryLookups } from "@/lib/rules/rule-summary";
import { transactionDisplayDate } from "@/lib/utils/transaction-date";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

/** How long the editor waits after the last edit before asking again. */
const PREVIEW_DEBOUNCE_MS = 400;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [value, delay]);
  return debounced;
}

function ChangeList({
  changes,
  lookups,
}: {
  changes: RulePreviewChanges;
  lookups: SummaryLookups;
}) {
  const t = useTranslations("rules.preview");
  const tRules = useTranslations("rules");
  const items: string[] = [];
  if (changes.categoryKey !== undefined)
    items.push(
      t("change-category", {
        name:
          lookups.category(changes.categoryKey) ?? tRules("summary.unknown"),
      }),
    );
  if (changes.merchant)
    items.push(t("change-merchant", { name: changes.merchant.name }));
  if (changes.description !== undefined)
    items.push(t("change-description", { value: changes.description }));
  if (changes.notes !== undefined)
    items.push(t("change-notes", { value: changes.notes }));
  if (changes.addTagKeys)
    items.push(
      t("change-tags", {
        names: changes.addTagKeys
          .map((key) => lookups.tag(key) ?? tRules("summary.unknown"))
          .join(", "),
      }),
    );
  if (changes.reviewed) items.push(t("change-reviewed"));
  if (changes.hidden) items.push(t("change-hidden"));

  if (items.length === 0)
    return <p className="text-muted-foreground text-xs">{t("no-change")}</p>;
  return (
    <ul className="text-primary flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
      {items.map((item) => (
        <li key={item} className="min-w-0 truncate">
          {item}
        </li>
      ))}
    </ul>
  );
}

/**
 * The live preview beside the rule editor: how many of the household's
 * transactions (that this member can see) the unsaved rule matches, how many
 * it would change, and the most recent matches with their change. `draft` is
 * null while the rule is incomplete.
 */
export function RulePreviewPanel({
  draft,
  lookups,
}: {
  draft: RuleDraft | null;
  lookups: SummaryLookups;
}) {
  const t = useTranslations("rules.preview");
  const formatDate = useFormatShortDate();
  // Serialized so an unchanged rule is the same query, whatever re-rendered it.
  const draftKey = useMemo(
    () => (draft ? JSON.stringify(draft) : null),
    [draft],
  );
  const debouncedKey = useDebounced(draftKey, PREVIEW_DEBOUNCE_MS);
  const debouncedDraft = useMemo(
    () => (debouncedKey ? (JSON.parse(debouncedKey) as RuleDraft) : null),
    [debouncedKey],
  );
  const { data, isError, isFetching } = useRulePreview(debouncedDraft);
  const settling = draftKey !== debouncedKey || isFetching;

  return (
    <section
      aria-labelledby="rule-preview-title"
      aria-busy={settling}
      className="bg-muted/40 border-border flex min-h-0 flex-col gap-3 rounded-md border p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id="rule-preview-title" className="text-sm font-medium">
          {t("title")}
        </h3>
        {draft && settling ? <Spinner className="size-4" /> : null}
      </div>

      {!draft ? (
        <p className="text-muted-foreground text-sm">{t("incomplete")}</p>
      ) : isError && !data ? (
        <p role="alert" className="text-muted-foreground text-sm">
          {t("error")}
        </p>
      ) : !data ? (
        <p className="text-muted-foreground text-sm">{t("loading")}</p>
      ) : (
        <>
          <p className="text-sm" aria-live="polite">
            <span className="font-medium">
              {t("matches", { count: data.matchCount })}
            </span>
            {data.matchCount > 0 ? (
              <span className="text-muted-foreground">
                {" · "}
                {t("changes", { count: data.changeCount })}
              </span>
            ) : null}
          </p>
          {data.matchCount > data.changeCount ? (
            <p className="text-muted-foreground text-xs">
              {t("protected-hint")}
            </p>
          ) : null}
          {data.transactions.length > 0 ? (
            <div className="flex min-h-0 flex-col gap-2">
              <p className="text-muted-foreground text-xs">
                {t("sample", { count: data.transactions.length })}
              </p>
              <ul className="divide-border border-border bg-background max-h-80 divide-y overflow-y-auto rounded-md border lg:max-h-[28rem]">
                {data.transactions.map((row) => (
                  <li key={row.transactionKey} className="space-y-1 px-3 py-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm">
                        {row.merchantName ?? row.description ?? "—"}
                      </span>
                      <Amount
                        value={row.amount}
                        currency={row.currency ?? undefined}
                        className="shrink-0 font-mono text-sm"
                      />
                    </div>
                    <div className="text-muted-foreground flex gap-2 text-xs">
                      <span className="shrink-0 font-mono">
                        {row.transactionDate
                          ? formatDate(
                              transactionDisplayDate(row.transactionDate),
                            )
                          : "—"}
                      </span>
                      <span className="min-w-0 truncate">
                        {[
                          row.accountName,
                          row.merchantName ? row.description : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {row.hidden ? (
                        <span className="shrink-0">{t("hidden")}</span>
                      ) : null}
                    </div>
                    <ChangeList changes={row.changes} lookups={lookups} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-muted-foreground text-xs">{t("scope-hint")}</p>
        </>
      )}
    </section>
  );
}

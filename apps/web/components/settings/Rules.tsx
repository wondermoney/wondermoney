"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Download,
  GripVertical,
  ListChecks,
  Pencil,
  Plus,
  Trash,
  Upload,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type DragEvent, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { ApplyRulesDialog } from "@/components/rules/ApplyRulesDialog";
import { ImportRulesDialog } from "@/components/rules/ImportRulesDialog";
import { RuleEditorDialog } from "@/components/rules/RuleEditorDialog";
import { useRuleLookups } from "@/components/rules/useRuleLookups";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { Switch } from "@/components/ui/switch";
import { Heading, Text } from "@/components/ui/Typography";
import {
  API_ERROR_CODE,
  getApiErrorCode,
  isDemoReadOnlyError,
} from "@/lib/api/errors";
import useRules, {
  invalidateRules,
  MAX_RULES_PER_HOUSEHOLD,
  type Rule,
  type RuleApplyTarget,
  rulesKey,
  useDeleteRule,
  useExportRules,
  useReorderRules,
  useUpdateRule,
} from "@/lib/api/rule/useRules";
import { summarizeRule, targetCategory } from "@/lib/rules/rule-summary";

const ALL_CATEGORIES = "all";

/** The list with `ruleKey` moved to `toIndex`. */
export function moveRule(
  rules: Rule[],
  ruleKey: number,
  toIndex: number,
): Rule[] {
  const from = rules.findIndex((rule) => rule.ruleKey === ruleKey);
  if (from === -1 || toIndex < 0 || toIndex >= rules.length || from === toIndex)
    return rules;
  const next = [...rules];
  const [moved] = next.splice(from, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/**
 * Settings → Rules: the household's rules in run order, each with a one-line
 * summary and an active switch. Reorder by dragging or with the arrow buttons
 * (keyboard); search by name and filter by the category a rule sets. Both
 * members of a household manage the same list.
 */
export default function Rules() {
  const t = useTranslations("rules");
  const tRoot = useTranslations();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useRules();
  const { lookups, options } = useRuleLookups();
  const updateRule = useUpdateRule();
  const deleteRule = useDeleteRule();
  const reorderRules = useReorderRules();
  const exportRules = useExportRules();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORIES);
  const [editor, setEditor] = useState<{ key: string; rule?: Rule } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<Rule | null>(null);
  const [importing, setImporting] = useState(false);
  const [applying, setApplying] = useState<{
    key: string;
    offer: boolean;
    ruleName?: string;
    target: RuleApplyTarget;
  } | null>(null);
  const closeApplying = useCallback(() => setApplying(null), []);
  const [dragging, setDragging] = useState<number | null>(null);

  const rules = useMemo(() => data?.rules ?? [], [data]);
  const filtering =
    search.trim().length > 0 || categoryFilter !== ALL_CATEGORIES;
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return rules.filter(
      (rule) =>
        (needle.length === 0 ||
          rule.name.toLocaleLowerCase().includes(needle)) &&
        (categoryFilter === ALL_CATEGORIES ||
          String(targetCategory(rule)) === categoryFilter),
    );
  }, [categoryFilter, rules, search]);
  const targetCategories = useMemo(() => {
    const keys = new Set(
      rules
        .map(targetCategory)
        .filter((key) => key !== null)
        .map(String),
    );
    return options.categories.filter((option) => keys.has(option.value));
  }, [options.categories, rules]);

  const notifyError = (error: unknown, message: string) => {
    if (isDemoReadOnlyError(error)) {
      toast.error(tRoot("demo-read-only-title"), {
        description: tRoot("demo-read-only-description"),
      });
      return;
    }
    toast.error(message);
  };

  const saveOrder = async (next: Rule[]) => {
    const previous = rules;
    queryClient.setQueryData(rulesKey, { rules: next });
    try {
      const saved = await reorderRules.mutateAsync(
        next.map((rule) => rule.ruleKey),
      );
      queryClient.setQueryData(rulesKey, { rules: saved });
    } catch (error) {
      queryClient.setQueryData(rulesKey, { rules: previous });
      if (getApiErrorCode(error) === API_ERROR_CODE.RULE_ORDER_STALE)
        toast.error(t("order-stale"));
      else notifyError(error, t("reorder-error"));
      await invalidateRules(queryClient);
    }
  };

  const move = (rule: Rule, toIndex: number) => {
    const next = moveRule(rules, rule.ruleKey, toIndex);
    if (next !== rules) void saveOrder(next);
  };

  const onToggle = async (rule: Rule, active: boolean) => {
    queryClient.setQueryData(rulesKey, {
      rules: rules.map((candidate) =>
        candidate.ruleKey === rule.ruleKey
          ? { ...candidate, active }
          : candidate,
      ),
    });
    try {
      await updateRule.mutateAsync({ ruleKey: rule.ruleKey, active });
    } catch (error) {
      notifyError(error, t("save-error"));
    }
    await invalidateRules(queryClient);
  };

  const onConfirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRule.mutateAsync(deleting.ruleKey);
      await invalidateRules(queryClient);
      toast.success(t("deleted"));
    } catch (error) {
      notifyError(error, t("save-error"));
    } finally {
      setDeleting(null);
    }
  };

  const onExport = async () => {
    try {
      const blob = await exportRules.mutateAsync();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "wondermoney-rules.json";
      link.click();
      URL.revokeObjectURL(url);
      toast.success(t("export.done"));
    } catch (error) {
      notifyError(error, t("export.error"));
    }
  };

  const onDrop = (event: DragEvent, target: Rule) => {
    event.preventDefault();
    if (dragging === null) return;
    const toIndex = rules.findIndex((rule) => rule.ruleKey === target.ruleKey);
    move(rules.find((rule) => rule.ruleKey === dragging) ?? target, toIndex);
    setDragging(null);
  };

  if (isLoading) return <Spinner />;

  const atLimit = rules.length >= MAX_RULES_PER_HOUSEHOLD;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Heading variant="h2">{t("title")}</Heading>
          <Text variant="lead" className="mt-1 max-w-prose text-sm">
            {t("description")}
          </Text>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            variant="ghost"
            title={t("export.hint")}
            loading={exportRules.isPending}
            disabled={rules.length === 0 || exportRules.isPending}
            onClick={() => void onExport()}
          >
            <Download className="size-4" />
            {t("export.action")}
          </Button>
          <Button variant="ghost" onClick={() => setImporting(true)}>
            <Upload className="size-4" />
            {t("import.action")}
          </Button>
          {rules.some((rule) => rule.active) ? (
            <Button
              variant="secondary"
              title={t("apply.action-all-hint")}
              onClick={() =>
                setApplying({
                  key: `all-${Date.now()}`,
                  offer: false,
                  target: "all",
                })
              }
            >
              <ListChecks className="size-4" />
              {t("apply.action-all")}
            </Button>
          ) : null}
          <Button
            disabled={atLimit}
            onClick={() => setEditor({ key: `new-${Date.now()}` })}
          >
            <Plus className="size-4" />
            {t("create")}
          </Button>
        </div>
      </div>
      {atLimit ? (
        <Text className="text-muted-foreground text-sm">
          {t("limit-reached", { max: MAX_RULES_PER_HOUSEHOLD })}
        </Text>
      ) : null}

      {isError ? (
        <div role="alert" className="flex items-center gap-3">
          <Text className="text-sm">{t("load-error")}</Text>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {tRoot("retry")}
          </Button>
        </div>
      ) : rules.length === 0 ? (
        <Text className="text-muted-foreground text-sm">{t("empty")}</Text>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("search-placeholder")}
              aria-label={t("search-label")}
              className="sm:max-w-xs"
            />
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger
                className="sm:w-64"
                aria-label={t("filter-category-label")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CATEGORIES}>
                  {t("filter-category-all")}
                </SelectItem>
                {targetCategories.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Text className="text-muted-foreground text-xs">
            {filtering ? t("order-filtered") : t("order-hint")}
          </Text>

          {visible.length === 0 ? (
            <Text className="text-muted-foreground text-sm">
              {t("no-results")}
            </Text>
          ) : (
            <ol className="divide-border border-border divide-y rounded-md border">
              {visible.map((rule) => {
                const index = rules.findIndex(
                  (candidate) => candidate.ruleKey === rule.ruleKey,
                );
                return (
                  <li
                    key={rule.ruleKey}
                    className={
                      dragging === rule.ruleKey
                        ? "bg-muted flex items-start gap-2 px-2 py-2 opacity-60"
                        : "flex items-start gap-2 px-2 py-2"
                    }
                    draggable={!filtering}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      setDragging(rule.ruleKey);
                    }}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={(event) => {
                      if (dragging !== null) event.preventDefault();
                    }}
                    onDrop={(event) => onDrop(event, rule)}
                  >
                    {!filtering ? (
                      <span
                        className="text-muted-foreground hidden h-11 cursor-grab items-center sm:flex"
                        title={t("drag-named", { name: rule.name })}
                        aria-hidden="true"
                      >
                        <GripVertical className="size-4" />
                      </span>
                    ) : null}
                    <span className="text-muted-foreground w-6 shrink-0 pt-3 text-right font-mono text-xs">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1 py-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={
                            rule.active
                              ? "truncate text-sm font-medium"
                              : "text-muted-foreground truncate text-sm font-medium"
                          }
                        >
                          {rule.name}
                        </span>
                        {!rule.active ? (
                          <Badge variant="muted">{t("inactive")}</Badge>
                        ) : null}
                        {rule.stopProcessing ? (
                          <Badge variant="outline">{t("stops")}</Badge>
                        ) : null}
                      </div>
                      <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                        {summarizeRule(rule, t, lookups)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Switch
                        checked={rule.active}
                        onCheckedChange={(active) =>
                          void onToggle(rule, active)
                        }
                        aria-label={t("toggle-named", { name: rule.name })}
                        className="mr-1"
                      />
                      {!filtering ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={index === 0 || reorderRules.isPending}
                            aria-label={t("move-up-named", { name: rule.name })}
                            onClick={() => move(rule, index - 1)}
                          >
                            <ArrowUp className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={
                              index === rules.length - 1 ||
                              reorderRules.isPending
                            }
                            aria-label={t("move-down-named", {
                              name: rule.name,
                            })}
                            onClick={() => move(rule, index + 1)}
                          >
                            <ArrowDown className="size-4" />
                          </Button>
                        </>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("edit-named", { name: rule.name })}
                        onClick={() =>
                          setEditor({
                            key: `rule-${rule.ruleKey}-${Date.now()}`,
                            rule,
                          })
                        }
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("delete-named", { name: rule.name })}
                        onClick={() => setDeleting(rule)}
                      >
                        <Trash className="size-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}

      {editor ? (
        <RuleEditorDialog
          key={editor.key}
          open
          rule={editor.rule}
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          onSaved={(saved) => {
            // Offer to apply the rule to the transactions already there.
            if (saved.active)
              setApplying({
                key: `rule-${saved.ruleKey}-${Date.now()}`,
                offer: true,
                ruleName: saved.name,
                target: { ruleKey: saved.ruleKey },
              });
          }}
        />
      ) : null}

      {applying ? (
        <ApplyRulesDialog
          key={applying.key}
          target={applying.target}
          ruleName={applying.ruleName}
          offer={applying.offer}
          onClose={closeApplying}
        />
      ) : null}

      <ImportRulesDialog
        open={importing}
        onOpenChange={setImporting}
        onImported={() => void invalidateRules(queryClient)}
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("delete-title", { name: deleting?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("delete-description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tRoot("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onConfirmDelete()}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

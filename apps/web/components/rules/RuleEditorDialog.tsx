"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import CategorySelect from "@/components/CategorySelect";
import { MultiSelect } from "@/components/reports/filters/MultiSelect";
import { TagPicker } from "@/components/tags/TagPicker";
import { Button } from "@/components/ui/button";
import { ComboboxCreatable } from "@/components/ui/combobox-creatable";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Switch } from "@/components/ui/switch";
import useTransactionMerchants from "@/lib/api/account/useTransactionMerchants";
import { getApiErrorMessage, isDemoReadOnlyError } from "@/lib/api/errors";
import {
  invalidateRules,
  MAX_RULE_CONDITIONS,
  type Rule,
  RULE_NAME_MAX_LENGTH,
  RULE_TEXT_MAX_LENGTH,
  UNCATEGORIZED,
  useCreateRule,
  useUpdateRule,
} from "@/lib/api/rule/useRules";
import {
  ACTION_TYPES,
  type ActionDraft,
  type ActionType,
  AMOUNT_OPERATORS,
  changeConditionField,
  CONDITION_FIELDS,
  type ConditionDraft,
  type ConditionField,
  emptyRuleForm,
  formToRule,
  isListField,
  isTextField,
  LIST_OPERATORS,
  newAction,
  newCondition,
  type RowProblem,
  type RuleFormState,
  ruleToForm,
  TEXT_OPERATORS,
} from "@/lib/rules/rule-draft";

import { RulePreviewPanel } from "./RulePreviewPanel";
import { useRuleLookups } from "./useRuleLookups";

type Lookups = ReturnType<typeof useRuleLookups>;

function FieldError({ id, problem }: { id: string; problem?: RowProblem }) {
  const t = useTranslations("rules.errors");
  if (!problem) return null;
  return (
    <p id={id} role="alert" className="text-destructive-text text-xs">
      {t(problem)}
    </p>
  );
}

function operatorsFor(field: ConditionField): string[] {
  if (isTextField(field)) return TEXT_OPERATORS;
  if (field === "amount") return AMOUNT_OPERATORS;
  if (field === "direction") return ["is"];
  return LIST_OPERATORS;
}

function ConditionRow({
  index,
  condition,
  problem,
  lookups,
  onChange,
  onRemove,
  canRemove,
}: {
  index: number;
  condition: ConditionDraft;
  problem?: RowProblem;
  lookups: Lookups;
  onChange: (condition: ConditionDraft) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const t = useTranslations("rules");
  const position = index + 1;
  const errorId = `condition-${condition.id}-error`;
  const invalid = problem !== undefined;

  const listOptions = (() => {
    switch (condition.field) {
      case "account":
        return lookups.options.accounts;
      case "category":
        return [
          { value: UNCATEGORIZED, label: t("uncategorized") },
          ...lookups.options.categories,
        ];
      case "transactionType":
        return lookups.options.transactionTypes;
      case "currency":
        return lookups.options.currencies;
      default:
        return [];
    }
  })();

  return (
    <li className="border-border space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-start gap-2">
        <Select
          value={condition.field}
          onValueChange={(field) =>
            onChange(changeConditionField(condition, field as ConditionField))
          }
        >
          <SelectTrigger
            className="w-full sm:w-44"
            aria-label={t("editor.field-label", { index: position })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONDITION_FIELDS.map((field) => (
              <SelectItem key={field} value={field}>
                {t(`fields.${field}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {condition.field !== "direction" ? (
          <Select
            value={condition.operator}
            onValueChange={(operator) => onChange({ ...condition, operator })}
          >
            <SelectTrigger
              className="w-full sm:w-44"
              aria-label={t("editor.operator-label", { index: position })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {operatorsFor(condition.field).map((operator) => (
                <SelectItem key={operator} value={operator}>
                  {t(`operators.${operator}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <div className="min-w-0 flex-1 basis-48">
          {isTextField(condition.field) ? (
            <Input
              value={condition.value}
              maxLength={RULE_TEXT_MAX_LENGTH}
              onChange={(event) =>
                onChange({ ...condition, value: event.target.value })
              }
              aria-label={t("editor.value-label", { index: position })}
              aria-invalid={invalid}
              aria-describedby={invalid ? errorId : undefined}
            />
          ) : condition.field === "amount" ? (
            condition.operator === "between" ? (
              <div className="flex items-center gap-2">
                <Input
                  inputMode="decimal"
                  className="font-mono"
                  value={condition.min}
                  placeholder={t("editor.min-label")}
                  onChange={(event) =>
                    onChange({ ...condition, min: event.target.value })
                  }
                  aria-label={`${t("editor.value-label", { index: position })}, ${t("editor.min-label")}`}
                  aria-invalid={invalid}
                  aria-describedby={invalid ? errorId : undefined}
                />
                <Input
                  inputMode="decimal"
                  className="font-mono"
                  value={condition.max}
                  placeholder={t("editor.max-label")}
                  onChange={(event) =>
                    onChange({ ...condition, max: event.target.value })
                  }
                  aria-label={`${t("editor.value-label", { index: position })}, ${t("editor.max-label")}`}
                  aria-invalid={invalid}
                  aria-describedby={invalid ? errorId : undefined}
                />
              </div>
            ) : (
              <Input
                inputMode="decimal"
                className="font-mono"
                value={condition.value}
                onChange={(event) =>
                  onChange({ ...condition, value: event.target.value })
                }
                aria-label={t("editor.value-label", { index: position })}
                aria-invalid={invalid}
                aria-describedby={invalid ? errorId : undefined}
              />
            )
          ) : condition.field === "direction" ? (
            <Select
              value={condition.value}
              onValueChange={(value) => onChange({ ...condition, value })}
            >
              <SelectTrigger
                aria-label={t("editor.value-label", { index: position })}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="out">{t("editor.direction-out")}</SelectItem>
                <SelectItem value="in">{t("editor.direction-in")}</SelectItem>
              </SelectContent>
            </Select>
          ) : isListField(condition.field) ? (
            <MultiSelect
              label={t("editor.value-label", { index: position })}
              options={listOptions}
              selected={condition.values}
              onChange={(values) => onChange({ ...condition, values })}
              placeholder={t("editor.values-placeholder")}
            />
          ) : null}
        </div>

        {canRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label={t("editor.remove-condition", { index: position })}
          >
            <Trash className="size-4" />
          </Button>
        ) : null}
      </div>
      {condition.field === "description" ? (
        <Select
          value={condition.source}
          onValueChange={(source) =>
            onChange({ ...condition, source: source as "cleaned" | "raw" })
          }
        >
          <SelectTrigger
            className="h-9 w-full text-xs sm:w-56"
            aria-label={t("editor.source-label", { index: position })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cleaned">
              {t("editor.source-cleaned")}
            </SelectItem>
            <SelectItem value="raw">{t("editor.source-raw")}</SelectItem>
          </SelectContent>
        </Select>
      ) : null}
      <FieldError id={errorId} problem={problem} />
    </li>
  );
}

function MerchantField({
  action,
  onChange,
}: {
  action: ActionDraft;
  onChange: (action: ActionDraft) => void;
}) {
  const t = useTranslations("rules.editor");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);
  const { data } = useTransactionMerchants({
    limit: 20,
    search: debouncedSearch || undefined,
  });
  const options = useMemo(() => {
    const names = (data?.transactionMerchants ?? []).map(
      (merchant) => merchant.name,
    );
    const current = action.merchant.trim();
    if (current && !names.includes(current)) names.unshift(current);
    return names.map((name) => ({ value: name, label: name }));
  }, [action.merchant, data]);

  return (
    <ComboboxCreatable
      options={options}
      selected={action.merchant}
      onChange={(value) =>
        onChange({ ...action, merchant: String(value), merchantId: null })
      }
      onCreate={(value) =>
        onChange({ ...action, merchant: value.trim(), merchantId: null })
      }
      createLabel={(value) => t("create-merchant", { merchant: value })}
      createEmptyHint={t("type-merchant")}
      onQueryChange={setSearch}
      placeholder={
        action.merchantId !== null && !action.merchant
          ? t("saved-merchant")
          : t("merchant-placeholder")
      }
    />
  );
}

function ActionRow({
  index,
  action,
  problem,
  usedTypes,
  lookups,
  onChange,
  onRemove,
  canRemove,
}: {
  index: number;
  action: ActionDraft;
  problem?: RowProblem;
  usedTypes: ActionType[];
  lookups: Lookups;
  onChange: (action: ActionDraft) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const t = useTranslations("rules");
  const position = index + 1;
  const errorId = `action-${action.id}-error`;
  const invalid = problem !== undefined;

  return (
    <li className="border-border space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-start gap-2">
        <Select
          value={action.type}
          onValueChange={(type) =>
            onChange({ ...newAction(type as ActionType), id: action.id })
          }
        >
          <SelectTrigger
            className="w-full sm:w-52"
            aria-label={t("editor.action-label", { index: position })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTION_TYPES.map((type) => (
              <SelectItem
                key={type}
                value={type}
                disabled={type !== action.type && usedTypes.includes(type)}
              >
                {t(`actions.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="min-w-0 flex-1 basis-48">
          {action.type === "set_category" ? (
            <CategorySelect
              key={action.id}
              categories={lookups.categories}
              initialValue={action.categoryId || undefined}
              onChange={(categoryId) => onChange({ ...action, categoryId })}
              triggerProps={{
                variant: "input",
                size: "default",
                className: "ml-0 w-full",
                "aria-label": t("editor.action-value-label", {
                  index: position,
                }),
                "aria-invalid": invalid,
              }}
            />
          ) : action.type === "set_merchant" ? (
            <MerchantField action={action} onChange={onChange} />
          ) : action.type === "set_description" ||
            action.type === "set_notes" ? (
            <Input
              value={action.value}
              maxLength={RULE_TEXT_MAX_LENGTH}
              onChange={(event) =>
                onChange({ ...action, value: event.target.value })
              }
              aria-label={t("editor.action-value-label", { index: position })}
              aria-invalid={invalid}
              aria-describedby={invalid ? errorId : undefined}
            />
          ) : action.type === "add_tags" ? (
            <TagPicker
              value={action.tagIds}
              onChange={(tagIds) => onChange({ ...action, tagIds })}
            />
          ) : null}
        </div>
        {canRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label={t("editor.remove-action", { index: position })}
          >
            <Trash className="size-4" />
          </Button>
        ) : null}
      </div>
      {action.type === "set_notes" ? (
        <p className="text-muted-foreground text-xs">
          {t("editor.notes-hint")}
        </p>
      ) : null}
      <FieldError id={errorId} problem={problem} />
    </li>
  );
}

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Create or edit a rule: name, all/any, condition rows, action rows, stop
 * processing, with a live preview of the matching transactions beside it.
 *
 * Mount it with a `key` per rule (or per transaction it starts from): the form
 * state is taken from the props once.
 */
export function RuleEditorDialog({
  open,
  onOpenChange,
  rule,
  initialForm,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the saved rule, after the dialog asks to close. */
  onSaved?: (rule: Rule) => void;
  /** The rule to edit; omit to create one. */
  rule?: Rule;
  /** A starting point for a new rule, such as one built from a transaction. */
  initialForm?: RuleFormState;
}) {
  const t = useTranslations("rules");
  const tRoot = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const lookups = useRuleLookups();
  const createRule = useCreateRule();
  const updateRule = useUpdateRule();

  const [form, setForm] = useState<RuleFormState>(() =>
    rule ? ruleToForm(rule, locale) : (initialForm ?? emptyRuleForm()),
  );
  const [active, setActive] = useState(rule?.active ?? true);
  const [showProblems, setShowProblems] = useState(false);

  const previewConversion = useMemo(
    () => formToRule(form, locale, { requireName: false }),
    [form, locale],
  );
  const conversion = useMemo(() => formToRule(form, locale), [form, locale]);
  const problems = conversion.ok ? null : conversion.problems;
  const shown = showProblems ? problems : null;

  const update = (changes: Partial<RuleFormState>) =>
    setForm((current) => ({ ...current, ...changes }));
  const setCondition = (id: string, next: ConditionDraft) =>
    update({
      conditions: form.conditions.map((row) => (row.id === id ? next : row)),
    });
  const setAction = (id: string, next: ActionDraft) =>
    update({
      actions: form.actions.map((row) => (row.id === id ? next : row)),
    });
  const usedTypes = form.actions.map((row) => row.type);
  const nextActionType = ACTION_TYPES.find((type) => !usedTypes.includes(type));

  const saving = createRule.isPending || updateRule.isPending;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!conversion.ok) {
      setShowProblems(true);
      return;
    }
    const { draft, name } = conversion;
    let saved: Rule;
    try {
      if (rule) {
        // Conditions and actions are sent only when they changed: sending
        // them makes the editor the rule's owner.
        saved = await updateRule.mutateAsync({
          ruleKey: rule.ruleKey,
          name,
          active,
          match: draft.match,
          stopProcessing: form.stopProcessing,
          ...(sameJson(draft.conditions, rule.conditions)
            ? {}
            : { conditions: draft.conditions }),
          ...(sameJson(draft.actions, rule.actions)
            ? {}
            : { actions: draft.actions }),
        });
        toast.success(t("updated"));
      } else {
        saved = await createRule.mutateAsync({
          name,
          active,
          match: draft.match,
          stopProcessing: form.stopProcessing,
          conditions: draft.conditions,
          actions: draft.actions,
        });
        toast.success(t("created"));
      }
      await invalidateRules(queryClient);
      onOpenChange(false);
      onSaved?.(saved);
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(tRoot("demo-read-only-title"), {
          description: tRoot("demo-read-only-description"),
        });
        return;
      }
      toast.error(t("save-error"), { description: getApiErrorMessage(error) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>
            {rule ? t("editor.edit-title") : t("editor.create-title")}
          </DialogTitle>
          <DialogDescription>{t("editor.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <form
            id="rule-editor-form"
            onSubmit={onSubmit}
            className="min-w-0 space-y-5"
            noValidate
          >
            <div className="space-y-2">
              <Label htmlFor="rule-name">{t("editor.name")}</Label>
              <Input
                id="rule-name"
                value={form.name}
                maxLength={RULE_NAME_MAX_LENGTH}
                onChange={(event) => update({ name: event.target.value })}
                aria-invalid={shown?.name !== undefined}
                aria-describedby={shown?.name ? "rule-name-error" : undefined}
              />
              {shown?.name ? (
                <p
                  id="rule-name-error"
                  role="alert"
                  className="text-destructive-text text-xs"
                >
                  {t(`errors.${shown.name}`)}
                </p>
              ) : null}
            </div>

            <fieldset className="space-y-3">
              <legend className="sr-only">{t("editor.conditions")}</legend>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p aria-hidden="true" className="text-sm font-medium">
                  {t("editor.conditions")}
                </p>
                <Select
                  value={form.match}
                  onValueChange={(match) =>
                    update({ match: match as RuleFormState["match"] })
                  }
                >
                  <SelectTrigger
                    className="h-9 w-auto"
                    aria-label={t("editor.match-label")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("editor.match-all")}</SelectItem>
                    <SelectItem value="any">{t("editor.match-any")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <ul className="space-y-2">
                {form.conditions.map((condition, index) => (
                  <ConditionRow
                    key={condition.id}
                    index={index}
                    condition={condition}
                    problem={shown?.conditions[condition.id]}
                    lookups={lookups}
                    canRemove={form.conditions.length > 1}
                    onChange={(next) => setCondition(condition.id, next)}
                    onRemove={() =>
                      update({
                        conditions: form.conditions.filter(
                          (row) => row.id !== condition.id,
                        ),
                      })
                    }
                  />
                ))}
              </ul>
              {form.conditions.length < MAX_RULE_CONDITIONS ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    update({ conditions: [...form.conditions, newCondition()] })
                  }
                >
                  <Plus className="size-4" />
                  {t("editor.add-condition")}
                </Button>
              ) : (
                <p className="text-muted-foreground text-xs">
                  {t("editor.conditions-limit", { max: MAX_RULE_CONDITIONS })}
                </p>
              )}
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-3 text-sm font-medium">
                {t("editor.actions")}
              </legend>
              <ul className="space-y-2">
                {form.actions.map((action, index) => (
                  <ActionRow
                    key={action.id}
                    index={index}
                    action={action}
                    problem={shown?.actions[action.id]}
                    usedTypes={usedTypes}
                    lookups={lookups}
                    canRemove={form.actions.length > 1}
                    onChange={(next) => setAction(action.id, next)}
                    onRemove={() =>
                      update({
                        actions: form.actions.filter(
                          (row) => row.id !== action.id,
                        ),
                      })
                    }
                  />
                ))}
              </ul>
              {shown?.duplicateActions ? (
                <p role="alert" className="text-destructive-text text-xs">
                  {t("editor.duplicate-actions")}
                </p>
              ) : null}
              {nextActionType ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    update({
                      actions: [...form.actions, newAction(nextActionType)],
                    })
                  }
                >
                  <Plus className="size-4" />
                  {t("editor.add-action")}
                </Button>
              ) : null}
            </fieldset>

            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="rule-stop-processing">
                    {t("editor.stop-processing")}
                  </Label>
                  <p
                    id="rule-stop-processing-hint"
                    className="text-muted-foreground text-xs"
                  >
                    {t("editor.stop-processing-hint")}
                  </p>
                </div>
                <Switch
                  id="rule-stop-processing"
                  checked={form.stopProcessing}
                  onCheckedChange={(stopProcessing) =>
                    update({ stopProcessing })
                  }
                  aria-describedby="rule-stop-processing-hint"
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="rule-active">{t("editor.active")}</Label>
                <Switch
                  id="rule-active"
                  checked={active}
                  onCheckedChange={setActive}
                />
              </div>
            </div>
          </form>

          <RulePreviewPanel
            draft={previewConversion.ok ? previewConversion.draft : null}
            lookups={lookups.lookups}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            {tRoot("cancel")}
          </Button>
          <Button
            type="submit"
            form="rule-editor-form"
            loading={saving}
            disabled={saving}
          >
            {t("editor.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Typography";
import { getApiErrorMessage, isDemoReadOnlyError } from "@/lib/api/errors";
import {
  importRules,
  type RuleImportMode,
  useImportRules,
} from "@/lib/api/rule/useRules";

/** Mirrors the API's limit, so an oversized file is refused before it is sent. */
export const MAX_RULES_FILE_BYTES = 1024 * 1024;

/** `File.text()` is not available in every browser/jsdom build; `FileReader` is. */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(file);
  });
}

/**
 * Import a `wondermoney-rules` file: choose it, see what the dry run would do
 * (creations, duplicates and unresolved references), then confirm. Nothing is
 * written until the confirm button; replace mode says how many rules it removes.
 */
export function ImportRulesDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const t = useTranslations("rules.import");
  const tRoot = useTranslations();
  const commit = useImportRules();

  const [file, setFile] = useState<{ name: string; value: unknown } | null>(
    null,
  );
  const [fileError, setFileError] = useState<string | null>(null);
  const [mode, setMode] = useState<RuleImportMode>("append");
  const [createCategories, setCreateCategories] = useState(false);

  // The dry run is a read: keyed on the file and the choices, it re-runs when
  // either changes, and nothing is written.
  const dryRun = useQuery({
    queryKey: [
      "rules",
      "import-dry-run",
      file?.value ?? null,
      mode,
      createCategories,
    ],
    queryFn: () => {
      if (!file) throw new Error("No rules file chosen");
      return importRules({
        createCategories,
        dryRun: true,
        file: file.value,
        mode,
      });
    },
    enabled: file !== null,
    gcTime: 0,
    retry: false,
  });

  const plan = dryRun.data ?? null;
  const planning = dryRun.isFetching;
  const error =
    fileError ??
    (dryRun.error
      ? (getApiErrorMessage(dryRun.error) ?? t("review-error"))
      : null);

  const reset = () => {
    setFile(null);
    setFileError(null);
    setMode("append");
    setCreateCategories(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const onFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const selected = event.target.files?.[0];
    setFileError(null);
    if (!selected) {
      setFile(null);
      return;
    }
    if (selected.size > MAX_RULES_FILE_BYTES) {
      setFile(null);
      setFileError(t("file-too-large"));
      return;
    }
    try {
      const value: unknown = JSON.parse(await readFileText(selected));
      setFile({ name: selected.name, value });
    } catch {
      setFile(null);
      setFileError(t("file-invalid"));
    }
  };

  const onConfirm = async (): Promise<void> => {
    if (!file || !plan) return;
    try {
      const result = await commit.mutateAsync({
        confirm: mode === "replace",
        createCategories,
        dryRun: false,
        file: file.value,
        mode,
      });
      toast.success(t("done", { count: result.imported }));
      onImported();
      handleOpenChange(false);
    } catch (cause) {
      if (isDemoReadOnlyError(cause)) {
        toast.error(tRoot("demo-read-only-title"), {
          description: tRoot("demo-read-only-description"),
        });
        return;
      }
      toast.error(t("error"), { description: getApiErrorMessage(cause) });
    }
  };

  const canConfirm =
    plan !== null && !planning && plan.creates.length > 0 && !commit.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rules-import-file">{t("file-label")}</Label>
            <Input
              id="rules-import-file"
              type="file"
              accept=".json,application/json"
              onChange={(event) => void onFile(event)}
            />
            <Text variant="mutedText" className="text-xs">
              {t("file-hint")}
            </Text>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rules-import-mode">{t("mode-label")}</Label>
            <Select
              value={mode}
              onValueChange={(value) => setMode(value as RuleImportMode)}
            >
              <SelectTrigger id="rules-import-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="append">{t("mode-append")}</SelectItem>
                <SelectItem value="replace">{t("mode-replace")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "replace" && plan ? (
            <Text role="alert" className="text-warning-text text-sm">
              {t("replace-warning", { count: plan.removed })}
            </Text>
          ) : null}

          {planning ? (
            <p className="flex items-center gap-2 text-sm">
              <Spinner />
              {t("reviewing")}
            </p>
          ) : null}

          {error ? (
            <Text role="alert" className="text-destructive-text text-sm">
              {error}
            </Text>
          ) : null}

          {plan && !planning ? (
            <div className="space-y-2">
              <Text className="text-sm font-medium">{t("summary-title")}</Text>
              <ul className="space-y-1 text-sm">
                <li>{t("creates", { count: plan.creates.length })}</li>
                {plan.duplicates.length > 0 ? (
                  <li className="text-muted-foreground">
                    {t("duplicates", { count: plan.duplicates.length })}
                  </li>
                ) : null}
                {plan.unresolved.length > 0 ? (
                  <li>
                    {t("unresolved", { count: plan.unresolved.length })}
                    <ul className="text-muted-foreground mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs">
                      {plan.unresolved.map((item, index) => (
                        <li
                          key={`${item.ruleName}-${item.kind}-${item.reference}-${index}`}
                        >
                          {t(`kind.${item.kind}`)}: {item.reference} —{" "}
                          {item.ruleName}
                        </li>
                      ))}
                    </ul>
                  </li>
                ) : null}
              </ul>
              {plan.unresolved.length > 0 ? (
                <Text variant="mutedText" className="text-xs">
                  {t("unresolved-hint")}
                </Text>
              ) : null}
              {plan.categoriesToCreate.length > 0 ? (
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="rules-import-create-categories"
                    checked={createCategories}
                    onCheckedChange={(checked) =>
                      setCreateCategories(checked === true)
                    }
                  />
                  <Label
                    htmlFor="rules-import-create-categories"
                    className="text-sm font-normal"
                  >
                    {t("create-categories", {
                      names: plan.categoriesToCreate.join(", "),
                    })}
                  </Label>
                </div>
              ) : null}
              {plan.creates.length === 0 &&
              plan.duplicates.length === 0 &&
              plan.unresolved.length === 0 ? (
                <Text variant="mutedText" className="text-sm">
                  {t("nothing")}
                </Text>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleOpenChange(false)}
          >
            {tRoot("cancel")}
          </Button>
          <Button
            type="button"
            loading={commit.isPending}
            disabled={!canConfirm}
            onClick={() => void onConfirm()}
          >
            {mode === "replace"
              ? t("replace", { count: plan?.creates.length ?? 0 })
              : t("confirm", { count: plan?.creates.length ?? 0 })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

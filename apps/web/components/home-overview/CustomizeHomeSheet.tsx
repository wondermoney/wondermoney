"use client";

import {
  type DashboardLayoutEntry,
  mergeDashboardLayout,
  moveDashboardSection,
  setDashboardSectionHidden,
} from "@wondermoney/shared/dashboard-layout";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/Label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/Typography";
import useUpdateUserPreferences from "@/lib/api/user-preferences/useUpdateUserPreferences";
import useUserPreferences from "@/lib/api/user-preferences/useUserPreferences";
import { cn } from "@/lib/utils";

/**
 * The home's "Customize" sheet: one row per section with up and down buttons
 * and a visibility switch. Order and visibility live in the per-user
 * preferences document, so the arrangement follows the person to their phone.
 *
 * Net worth is listed but cannot be moved or hidden — it is the figure the page
 * exists for. The setup checklist is not in this list: it keeps its own
 * dismissal.
 *
 * The draft is local while the sheet is open so two quick presses compose; each
 * change is still PATCHed as the whole layout, and the response replaces the
 * cached document. Closing discards the draft, which by then matches the server
 * unless a save failed (the error and its retry stay visible until it closes).
 */
export function CustomizeHomeSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("homeOverview.customize");
  const preferences = useUserPreferences();
  const update = useUpdateUserPreferences();
  const [draft, setDraft] = useState<DashboardLayoutEntry[] | null>(null);

  // Reopening starts from what the server holds, not from the last attempt.
  const handleOpenChange = (next: boolean) => {
    if (!next) setDraft(null);
    onOpenChange(next);
  };

  const layout = mergeDashboardLayout(
    draft ?? preferences.data?.dashboardLayout,
  );
  const saving = update.isPending;
  const sectionName = (id: string) => t(`sections.${id}`);

  const save = (next: DashboardLayoutEntry[]) => {
    setDraft(next);
    update.mutate({ dashboardLayout: next });
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-md"
      >
        <SheetHeader className="space-y-2 pb-4">
          <SheetTitle className="text-xl font-semibold tracking-tight">
            {t("title")}
          </SheetTitle>
          <SheetDescription className="text-sm">
            {t("description")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {preferences.isPending ? (
            <div aria-busy="true" className="space-y-3 py-2">
              {layout.map((entry) => (
                <div
                  key={entry.id}
                  className="bg-muted h-11 animate-pulse rounded-md"
                />
              ))}
            </div>
          ) : preferences.isError ? (
            <div className="flex flex-wrap items-center gap-3 py-2" role="alert">
              <Text className="text-destructive-text text-sm">
                {t("loadError")}
              </Text>
              <Button
                className="min-h-11 px-2"
                variant="link"
                onClick={() => preferences.refetch()}
              >
                {t("retry")}
              </Button>
            </div>
          ) : (
            <ul className="divide-border divide-y">
              {layout.map((entry, index) => {
                const pinned = entry.id === "net-worth";
                const name = sectionName(entry.id);
                const switchId = `home-section-${entry.id}`;
                const canMoveUp = !pinned && index > 1;
                const canMoveDown = !pinned && index < layout.length - 1;

                return (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <Label
                        htmlFor={switchId}
                        className={cn(
                          "block text-sm font-medium",
                          pinned ? "cursor-default" : "cursor-pointer",
                        )}
                      >
                        {name}
                      </Label>
                      {pinned ? (
                        <Text className="text-muted-foreground block text-xs">
                          {t("pinned")}
                        </Text>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        aria-label={t("moveUp", { section: name })}
                        disabled={!canMoveUp || saving}
                        onClick={() =>
                          save(moveDashboardSection(layout, entry.id, "up"))
                        }
                        size="icon"
                        variant="ghost"
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        aria-label={t("moveDown", { section: name })}
                        disabled={!canMoveDown || saving}
                        onClick={() =>
                          save(moveDashboardSection(layout, entry.id, "down"))
                        }
                        size="icon"
                        variant="ghost"
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                    </div>

                    <Label
                      htmlFor={switchId}
                      className={cn(
                        "flex min-h-11 min-w-11 shrink-0 items-center justify-end",
                        pinned || saving
                          ? "cursor-not-allowed"
                          : "cursor-pointer",
                      )}
                    >
                      <Switch
                        id={switchId}
                        checked={!entry.hidden}
                        disabled={pinned || saving}
                        onCheckedChange={(visible) =>
                          save(
                            setDashboardSectionHidden(
                              layout,
                              entry.id,
                              !visible,
                            ),
                          )
                        }
                      />
                    </Label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div aria-live="polite" className="min-h-6 pt-2">
          {saving ? (
            <Text className="text-muted-foreground text-xs">{t("saving")}</Text>
          ) : null}
          {update.isError ? (
            <div className="flex flex-wrap items-center gap-3" role="alert">
              <Text className="text-destructive-text text-xs">
                {t("saveError")}
              </Text>
              <Button
                className="min-h-11 px-2"
                variant="link"
                onClick={() => update.mutate({ dashboardLayout: layout })}
              >
                {t("retry")}
              </Button>
            </div>
          ) : null}
        </div>

        <SheetFooter className="gap-2 pt-2 sm:justify-between">
          <Button
            disabled={saving}
            onClick={() => save([])}
            variant="secondary"
          >
            {t("reset")}
          </Button>
          <Button onClick={() => handleOpenChange(false)} variant="ghost">
            {t("done")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export default CustomizeHomeSheet;

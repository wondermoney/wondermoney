"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type {
  AdminModuleId,
  AdminModuleVisibility,
} from "@/lib/admin/module-visibility";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  visibility: AdminModuleVisibility;
  setModuleVisible: (moduleId: AdminModuleId, visible: boolean) => void;
  showAllAdminModules: () => void;
  viewAsRegularUser: () => void;
};

const adminModuleLabels: Array<{
  id: AdminModuleId;
  translationKey: string;
}> = [
  { id: "credits", translationKey: "navigation.admin-module-credits" },
  { id: "goals", translationKey: "navigation.admin-module-goals" },
  {
    id: "financialMarkets",
    translationKey: "navigation.admin-module-financial-markets",
  },
  { id: "recurring", translationKey: "navigation.admin-module-recurring" },
  { id: "assistant", translationKey: "navigation.admin-module-assistant" },
];

export default function AdminModuleVisibilityDialog({
  open,
  onOpenChange,
  visibility,
  setModuleVisible,
  showAllAdminModules,
  viewAsRegularUser,
}: Props) {
  const t = useTranslations();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-5">
        <DialogHeader>
          <DialogTitle>{t("navigation.admin-visibility-title")}</DialogTitle>
          <DialogDescription>
            {t("navigation.admin-visibility-description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-muted-foreground text-xs">
            {t("navigation.admin-visibility-browser-only")}
          </p>

          <div className="rounded-lg border">
            {adminModuleLabels.map((module, index) => {
              const switchId = `admin-module-${module.id}`;

              return (
                <div key={module.id}>
                  <div className="flex items-center justify-between gap-4 p-4">
                    <label
                      htmlFor={switchId}
                      className="text-sm leading-none font-medium"
                    >
                      {t(module.translationKey)}
                    </label>
                    <Switch
                      id={switchId}
                      checked={visibility[module.id]}
                      onCheckedChange={(checked) =>
                        setModuleVisible(module.id, checked)
                      }
                    />
                  </div>
                  {index < adminModuleLabels.length - 1 && <Separator />}
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter className="gap-2 pt-0 sm:justify-between sm:space-x-0">
          <Button
            type="button"
            variant="outline"
            onClick={viewAsRegularUser}
          >
            {t("navigation.admin-visibility-view-regular")}
          </Button>
          <Button type="button" onClick={showAllAdminModules}>
            {t("navigation.admin-visibility-show-all")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

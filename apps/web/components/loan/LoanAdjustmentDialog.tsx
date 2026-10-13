"use client";

import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/components/ui/card";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import type { LoanDetail } from "@/lib/api/loan/types";

export default function LoanAdjustmentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loan: LoanDetail;
}) {
  const t = useTranslations("loans");
  return (
    <DrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("detail.adjustment.unavailableTitle")}
      description={t("detail.adjustment.unavailableDescription")}
      closable
    >
      <Card>
        <CardContent className="text-muted-foreground p-4 text-sm">
          {t("detail.adjustment.unavailableBody")}
        </CardContent>
      </Card>
    </DrawerDialog>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { DrawerDialog } from "@/components/ui/dialog-responsive";

import CreateGoalForm from "./CreateGoalForm";

interface GoalCreateDialogProps {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
}

const FORM_ID = "create-goal-dialog-form";

export default function GoalCreateDialog({
  isOpen,
  setOpen,
}: GoalCreateDialogProps) {
  const t = useTranslations();
  const router = useRouter();
  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={setOpen}
      title={t("goals.create-title")}
      description={t("goals.create-description")}
    >
      <CreateGoalForm
        formId={FORM_ID}
        onSuccess={(goalKey) => {
          setOpen(false);
          router.push(goalKey ? `/goals/${goalKey}` : "/goals");
        }}
      />
    </DrawerDialog>
  );
}

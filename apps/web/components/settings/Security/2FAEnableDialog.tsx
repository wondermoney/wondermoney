"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { DrawerDialog } from "@/components/ui/dialog-responsive";

import { useTwoFactorEnrollmentFlow } from "./useTwoFactorEnrollmentFlow";

const TwoFactorAuthEnableDialog: React.FC = () => {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const { title, stepDescription, footer, content, reset } =
    useTwoFactorEnrollmentFlow({
      onEnrolled: () => setOpen(false),
    });

  const onOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      reset();
    }
  };

  return (
    <DrawerDialog
      title={title}
      triggerLabel={t("enable-2fa")}
      footer={footer}
      open={open}
      onOpenChange={onOpenChange}
      description={stepDescription}
    >
      {content}
    </DrawerDialog>
  );
};

export default TwoFactorAuthEnableDialog;

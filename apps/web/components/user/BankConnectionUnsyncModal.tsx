"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";

import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { Text } from "@/components/ui/Typography";
import useDeleteRequisition from "@/lib/api/banking/useDeleteRequisition";

interface BankConnectionUnsyncModalProps {
  isOpen: boolean;
  closeModal: () => void;
  requisitionData: {
    id: string | number;
    daysLeft: number;
    accountNames: string[];
  };
}

const BankConnectionUnsyncModal: React.FC<BankConnectionUnsyncModalProps> = ({
  isOpen,
  closeModal,
  requisitionData,
}) => {
  const t = useTranslations();
  const posthog = usePostHog();
  const deleteRequisitionMutation = useDeleteRequisition();
  const formatter = new Intl.ListFormat("en", {
    style: "long",
    type: "conjunction",
  });
  const onUnsyncAccount = () => {
    posthog.capture("unsync account", { requisitionKey: requisitionData.id });
    deleteRequisitionMutation.mutate(
      { requisitionKey: requisitionData.id },
      {
        onSuccess: () => {
          closeModal();
        },
      },
    );
  };
  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) closeModal();
      }}
      title={t("unsync-account")}
      contentClassName="max-w-[500px]"
      footer={
        <>
          <Button variant="outline" onClick={closeModal}>
            {t("cancel")}
          </Button>
          <Button color="danger" onClick={onUnsyncAccount}>
            {t("unsync")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col">
        <div className="text-center">
          <AlertTriangle size="50px" color="orange.300" />
        </div>
        <Text className="mt-4">{t("account-unsync-confirmation")}</Text>
        <Text className="mt-2 underline underline-offset-4">
          {t("account-unsync-note")}
        </Text>
        <Text className="mt-4 font-semibold">
          {t("accounts")}: {formatter.format(requisitionData.accountNames)}
        </Text>
        {/* <Checkbox mt={4}>Also delete existing account data</Checkbox> */}
      </div>
    </DrawerDialog>
  );
};

export default BankConnectionUnsyncModal;

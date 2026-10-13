"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { Text } from "@/components/ui/Typography";
import useDeletePortfolioTransaction from "@/lib/api/portfolio/useDeletePortfolioTransaction";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";

interface PortfolioTransactionDeleteModalProps {
  isOpen: boolean;
  closeModal: () => void;
  portfolioId: number;
  transactionId: number;
  ticker?: string;
}

const PortfolioTransactionDeleteModal = (
  props: PortfolioTransactionDeleteModalProps,
) => {
  const t = useTranslations();
  const notifyIfRateLimited = useRateLimitToast();
  const { isOpen, closeModal, portfolioId, transactionId, ticker } = props;
  const deleteMutation = useDeletePortfolioTransaction();

  const handleDelete = () => {
    deleteMutation.mutate(
      { portfolioId, transactionId },
      {
        onSuccess: () => {
          toast.success(t("transaction-deleted"));
          closeModal();
        },
        onError: (error) => {
          if (notifyIfRateLimited(error)) return;
          toast.error(t("error-deleting-transaction"));
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
      title={t("delete-transaction")}
      footer={
        <>
          <Button
            type="button"
            color="danger"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? t("deleting") : t("delete")}
          </Button>
          <Button type="button" variant="outline" onClick={closeModal}>
            {t("cancel")}
          </Button>
        </>
      }
    >
      <Text as="p">
        {t("delete-transaction-confirmation")}
        {ticker && (
          <span className="font-semibold"> ({ticker})</span>
        )}
      </Text>
    </DrawerDialog>
  );
};

export default PortfolioTransactionDeleteModal;

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Text } from "@/components/ui/Typography";
import useEditTransactions from "@/lib/api/account/useEditTransactions";
import { Transaction } from "@/lib/api/account/useTransactions";
import useConfigs from "@/lib/api/configs/useConfigs";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import { useDisclosure } from "@/lib/utils/useDIsclosure";

import CategorySelect from "../CategorySelect";
import Slide from "../ui/Animations/Slide";
import { Button } from "../ui/button";

interface TransactionReviewControlProps {
  transactions: Transaction[];
  onResetSelection: () => void;
}

const TransactionReviewControl: React.FC<TransactionReviewControlProps> = ({
  transactions,
  onResetSelection,
}) => {
  const t = useTranslations();
  const posthog = usePostHog();
  const transactionIds = transactions.map((t) => t.transactionKey.toString());
  const allTransactionsReviewed = transactions.every((t) => t.reviewed);
  const allTransactionsVisible = transactions.every((t) => !t.hidden);
  const allTransactionsHidden = transactions.every((t) => t.hidden);
  const [opened, { toggle }] = useDisclosure();

  useEffect(() => {
    if (transactions.length > 0 && !opened) {
      toggle();
    }
    if (transactions.length === 0 && opened) {
      toggle();
    }
  }, [transactions.length, opened, toggle]);

  const { data: configsData, isLoading: isLoadingConfigs } = useConfigs();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync } = useEditTransactions();
  const queryClient = useQueryClient();
  const onChangeCategory = async (value: string) => {
    setIsSubmitting(true);
    posthog.capture("account_transaction_review_set_category", {
      transactionIds,
      categoryId: value,
    });
    try {
      await mutateAsync({
        transactionIds,
        categoryId: value,
        reviewed: true,
      });
      await queryClient.invalidateQueries({
        queryKey: ["accounts-transactions"],
      });
      onResetSelection();
      toast.success(t("transaction-reviewed"));
      toggle();
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(t("demo-read-only-title"), {
          description: t("demo-read-only-description"),
        });
        return;
      }

      toast.error(t("toast-edit-transaction-error"), {
        duration: 9000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  const onChangeReviewed = async () => {
    setIsSubmitting(true);
    posthog.capture("account_transactions_review_set_reviewed", {
      transactionIds,
    });
    try {
      await mutateAsync({ transactionIds, reviewed: true });
      await queryClient.invalidateQueries({
        queryKey: ["accounts-transactions"],
      });
      onResetSelection();
      toast.success(t("transaction-reviewed"));
      toggle();
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(t("demo-read-only-title"), {
          description: t("demo-read-only-description"),
        });
        return;
      }

      toast.error(t("toast-edit-transaction-error"), {
        duration: 9000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  const onChangeHidden = async (hidden: boolean) => {
    setIsSubmitting(true);
    posthog.capture("account_transactions_review_set_hidden", {
      transactionIds,
      hidden,
    });
    try {
      await mutateAsync({ transactionIds, hidden });
      await queryClient.invalidateQueries({
        queryKey: ["accounts-transactions"],
      });
      onResetSelection();
      toast.success(
        t(hidden ? "transaction-hidden-toast" : "transaction-unhidden-toast"),
      );
      toggle();
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(t("demo-read-only-title"), {
          description: t("demo-read-only-description"),
        });
        return;
      }

      toast.error(t("toast-edit-transaction-error"), {
        duration: 9000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Slide isOpen={opened} classname="z-10">
      <div className="bg-card mx-auto mb-8 flex w-fit flex-col gap-4 rounded-md border p-4 md:flex-row md:items-center md:gap-6">
        <Text className="w-[120px] text-center">
          <strong>{transactions.length}</strong> {t("selected").toLowerCase()}
        </Text>
        <div className="flex gap-6">
          <CategorySelect
            triggerProps={{
              variant: "outline",
              size: "default",
              loading: isLoadingConfigs,
              className: "text-foreground",
            }}
            categories={configsData?.categories ?? []}
            onChange={onChangeCategory}
          />
          {!allTransactionsReviewed && (
            <Button
              onClick={onChangeReviewed}
              variant="outline"
              loading={isSubmitting}
              disabled={isSubmitting}
              className="text-foreground"
            >
              {t("reviewed")}
              <CheckCircle className="ml-2 size-4" />
            </Button>
          )}
          {allTransactionsVisible && (
            <Button
              onClick={() => onChangeHidden(true)}
              variant="outline"
              loading={isSubmitting}
              disabled={isSubmitting}
              className="text-foreground"
            >
              {t("hide")}
            </Button>
          )}
          {allTransactionsHidden && (
            <Button
              onClick={() => onChangeHidden(false)}
              variant="outline"
              loading={isSubmitting}
              disabled={isSubmitting}
              className="text-foreground"
            >
              {t("unhide")}
            </Button>
          )}
        </div>
      </div>
    </Slide>
  );
};

export default TransactionReviewControl;

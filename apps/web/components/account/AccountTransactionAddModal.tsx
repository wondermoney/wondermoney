"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Plus, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";
import { SubmitHandler } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import {
  toTransactionRequest,
  type TransactionFormValues,
} from "@/lib/account/transaction-form-schema";
import { Account } from "@/lib/api/account/useAccounts";
import useConfirmTransactionOcr from "@/lib/api/account/useConfirmTransactionOcr";
import useCreateTransaction from "@/lib/api/account/useCreateTransaction";
import useRejectTransactionOcr from "@/lib/api/account/useRejectTransactionOcr";
import { isDemoReadOnlyError } from "@/lib/api/errors";
import { useFeature } from "@/lib/api/instance/useInstance";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import { cn } from "@/lib/utils";
import { invalidateAccounts } from "@/lib/utils/queryInvalidation";
import { useLocalStorageItem } from "@/lib/utils/useLocalStorageItem";

import AccountTransactionAddForm from "./AccountTransactionAddForm";
import AccountTransactionOcrContent, {
  TransactionOcrData,
} from "./AccountTransactionOcrContent";

interface AccountTransactionAddModalProps {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  accounts: Account[];
  trigger?: React.ReactNode;
}

type AccountTransactionFormData = TransactionFormValues;

enum TransactionAddStep {
  MANUAL,
  OCR,
  OCR_FILLED,
}

const AccountTransactionAddModal: React.FC<AccountTransactionAddModalProps> = ({
  isOpen,
  setOpen,
  accounts,
  trigger,
}) => {
  const t = useTranslations();
  const notifyIfRateLimited = useRateLimitToast();

  const posthog = usePostHog();
  const queryClient = useQueryClient();

  const [currentStep, setCurrentStep] = useState<TransactionAddStep>(
    TransactionAddStep.MANUAL,
  );
  const [ocrKey, setOcrKey] = useState<number>();
  const [ocrData, setOcrData] = useState<TransactionOcrData>();
  // The OCR step remembers the user's terms acceptance in localStorage.
  const storedTermsAccept = useLocalStorageItem("terms_and_conditions_accept");
  const termsAndConditionsAccept =
    storedTermsAccept === null ? undefined : Boolean(storedTermsAccept);

  const createTransactionMutation = useCreateTransaction();
  const confirmTransactionOcrMutation = useConfirmTransactionOcr();
  const rejectTransactionOcrMutation = useRejectTransactionOcr();

  const onOcrComplete = (
    transactionOcrImportId: number,
    transactionData: TransactionOcrData,
  ) => {
    setOcrKey(transactionOcrImportId);
    setOcrData(transactionData);
    setCurrentStep(TransactionAddStep.OCR_FILLED);
  };

  const onManualAddSubmit: SubmitHandler<AccountTransactionFormData> = async (
    data,
  ) => {
    await createTransactionMutation.mutateAsync(toTransactionRequest(data), {
      onSuccess: async (response) => {
        await invalidateAccounts(queryClient);
        setOpen(false);
        posthog.capture("transaction_added", {
          transaction_type: data.transactionTypeId,
          currency: data.settlementCurrencyId,
          via: "manual",
        });
        toast.success(t("toast-add-transaction-success"), { duration: 9000 });
        // Warn-and-allow: the transaction was created; just flag a likely duplicate.
        const possibleDuplicate = (
          response as { data?: { possibleDuplicate?: boolean } } | undefined
        )?.data?.possibleDuplicate;
        if (possibleDuplicate) {
          posthog.capture("transaction_possible_duplicate");
          toast.warning(t("toast-possible-duplicate"), { duration: 9000 });
        }
      },
      onError: (error) => {
        if (notifyIfRateLimited(error)) return;
        if (isDemoReadOnlyError(error)) {
          toast.error(t("demo-read-only-title"), {
            description: t("demo-read-only-description"),
            duration: 9000,
          });
          return;
        }

        toast.error(t("toast-add-transaction-error"), { duration: 9000 });
      },
    });
  };

  const onOCrDataSubmit: SubmitHandler<AccountTransactionFormData> = async (
    data,
  ) => {
    if (!ocrKey) {
      toast.error(t("toast-add-transaction-error"), { duration: 9000 });
      return;
    }

    await confirmTransactionOcrMutation.mutateAsync(
      {
        transactionOcrImportId: ocrKey,
        ...toTransactionRequest(data),
      },
      {
        onSuccess: async () => {
          await invalidateAccounts(queryClient);
          setOpen(false);
          posthog.capture("transaction_added", {
            transaction_type: data.transactionTypeId,
            currency: data.settlementCurrencyId,
            via: "ocr",
          });
          toast.success(t("toast-add-transaction-success"), { duration: 9000 });
        },
        onError: (error) => {
          if (notifyIfRateLimited(error)) return;
          if (isDemoReadOnlyError(error)) {
            toast.error(t("demo-read-only-title"), {
              description: t("demo-read-only-description"),
              duration: 9000,
            });
            return;
          }

          toast.error(t("toast-add-transaction-error"), { duration: 9000 });
        },
      },
    );
  };

  const _setOpen = async (open: boolean) => {
    setOpen(open);

    if (!open && currentStep === TransactionAddStep.OCR_FILLED && ocrKey) {
      try {
        await rejectTransactionOcrMutation.mutateAsync(
          { transactionOcrImportId: ocrKey },
          {
            onSuccess: async () => {
              posthog.capture("account_transaction_reject_ocr_success");
            },
          },
        );
      } catch (error) {
        if (isDemoReadOnlyError(error)) {
          toast.error(t("demo-read-only-title"), {
            description: t("demo-read-only-description"),
            duration: 9000,
          });
        } else {
          toast.error(t("toast-add-transaction-error"), { duration: 9000 });
        }
      }
    }
    setCurrentStep(TransactionAddStep.MANUAL);
    setOcrKey(undefined);
    setOcrData(undefined);
  };

  // Receipt scanning needs a vision model on the server.
  const canScanReceipt = useFeature((features) => features.ai.ocr);

  const renderFooterButtons = () => {
    switch (currentStep) {
      case TransactionAddStep.MANUAL:
        return (
          <div className={cn("grid grid-cols-1 gap-2", canScanReceipt && "md:grid-cols-2")}>
            {canScanReceipt && (
              <Button
                type="button"
                variant="outline"
                loading={createTransactionMutation.isPending}
                onClick={() => setCurrentStep(TransactionAddStep.OCR)}
                className="gap-2"
              >
                <Sparkles strokeWidth={1} />
                {t("autofill-transaction")}
              </Button>
            )}
            <Button
              type="submit"
              loading={createTransactionMutation.isPending}
              disabled={createTransactionMutation.isPending}
              form="add-account-transaction-form"
            >
              {createTransactionMutation.isPending
                ? t("creating_transaction")
                : t("create_transaction")}
            </Button>
          </div>
        );
      case TransactionAddStep.OCR:
        return (
          <Button
            type="submit"
            loading={createTransactionMutation.isPending}
            form="add-account-transaction-form"
          >
            {t("extract-data")}
          </Button>
        );
      case TransactionAddStep.OCR_FILLED:
        return (
          <Button
            type="submit"
            loading={confirmTransactionOcrMutation.isPending}
            form="add-account-transaction-form"
          >
            {confirmTransactionOcrMutation.isPending
              ? t("submitting")
              : t("submit")}
          </Button>
        );
    }
  };

  const title = () => {
    switch (currentStep) {
      case TransactionAddStep.MANUAL:
      case TransactionAddStep.OCR_FILLED:
        return t("add-transaction");
      case TransactionAddStep.OCR:
        return t("extract-from-invoice");
    }
  };

  const renderContent = () => {
    switch (currentStep) {
      case TransactionAddStep.MANUAL:
      case TransactionAddStep.OCR_FILLED:
        return (
          <AccountTransactionAddForm
            accounts={accounts}
            ocrData={ocrData}
            onSubmit={
              currentStep === TransactionAddStep.MANUAL
                ? onManualAddSubmit
                : onOCrDataSubmit
            }
          />
        );
      case TransactionAddStep.OCR:
        return (
          <AccountTransactionOcrContent
            termsAndConditionsAccept={termsAndConditionsAccept}
            onOcrSubmitting={(submitting) => {
              // We don't need to do anything here since we're using the mutation's isPending status
            }}
            onOcrComplete={onOcrComplete}
          />
        );
    }
  };

  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={_setOpen}
      title={title()}
      trigger={
        // `trigger={null}` means the caller opens this modal itself (e.g. an
        // `isOpen`/`setOpen`-controlled call site with no visible button) and
        // wants no trigger rendered at all — distinct from "not passed",
        // which falls back to the default button. `trigger ?? <Button>` alone
        // can't tell those apart, since `null` is nullish too. Passing an
        // empty Fragment instead doesn't work: Radix's
        // `DialogTrigger asChild` clones its own props (e.g. `type`)
        // onto that Fragment, which can only accept `key`/`children` and
        // logs "Invalid prop `type` supplied to `React.Fragment`" on every
        // render. Matches the `trigger !== undefined` pattern in
        // PortfolioTransactionAddModal.
        trigger !== undefined ? (
          (trigger ?? undefined)
        ) : (
          <Button className="grow gap-2" size="sm">
            <Plus className="size-4" />
            {t("add-transaction")}
          </Button>
        )
      }
      footer={renderFooterButtons()}
    >
      {renderContent()}
    </DrawerDialog>
  );
};

export default AccountTransactionAddModal;

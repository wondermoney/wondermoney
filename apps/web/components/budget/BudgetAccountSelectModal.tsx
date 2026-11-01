"use client";

import { Link, Unlink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useForm } from "react-hook-form";

import OpenBankingNotice from "@/components/account/OpenBankingNotice";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/Form";
import type { Account } from "@/lib/api/account/useAccounts";
import type { Account as BudgetAccount } from "@/lib/api/budget/useBudgetAccounts";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { DrawerDialog } from "../ui/dialog-responsive";
import { Label } from "../ui/Label";
import { Separator } from "../ui/separator";
import { Spinner } from "../ui/Spinner";
import { Heading, Text } from "../ui/Typography";

interface BudgetAccountSelectModalProps {
  isOpen: boolean;
  isLoadingRequisition: boolean;
  accounts: Account[] | undefined;
  budgetAccounts: BudgetAccount[] | undefined;
  setOpen: (open: boolean) => void;
  onAccountsSelected: (accountKeys: number[]) => Promise<void>;
  onAddSyncAccountClick: () => void;
  onAddOfflineAccountClick: () => void;
}

interface AccountTransactionFormData {
  selectedAccounts: number[];
}

const BudgetAccountSelectModal = ({
  isOpen,
  isLoadingRequisition,
  accounts,
  budgetAccounts,
  setOpen,
  onAccountsSelected,
  onAddSyncAccountClick,
  onAddOfflineAccountClick,
}: BudgetAccountSelectModalProps) => {
  const t = useTranslations();
  const methods = useForm<AccountTransactionFormData>({
    defaultValues: { selectedAccounts: [] },
  });

  const {
    handleSubmit,
    formState: { isSubmitting },
    reset,
  } = methods;

  useEffect(() => {
    if (!budgetAccounts) return;

    reset();
    methods.setValue(
      "selectedAccounts",
      budgetAccounts.map((account) => account.accountKey),
    );
  }, [budgetAccounts, isOpen, reset, methods]);

  const onAccountSelect = (accountId: number) => {
    const selectedAccounts = methods.getValues("selectedAccounts");
    if (selectedAccounts.includes(accountId)) {
      const accountsWithoutAccount = selectedAccounts.filter(
        (id) => id !== accountId,
      );
      methods.setValue("selectedAccounts", accountsWithoutAccount);
    } else {
      methods.setValue("selectedAccounts", [...selectedAccounts, accountId]);
    }
  };

  const onSubmit = async (data: AccountTransactionFormData) => {
    await onAccountsSelected(data.selectedAccounts);
  };

  const triggerButton = (
    <Button loading={!accounts || !budgetAccounts}>
      {!!budgetAccounts
        ? budgetAccounts.length === 0
          ? t("link-account")
          : t("linked-accounts", { count: budgetAccounts.length })
        : undefined}
      <Link size={16} className="ml-2" />
    </Button>
  );

  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={setOpen}
      title={t("link-account")}
      description={t("link-account-subtitle")}
      trigger={triggerButton}
    >
      {isLoadingRequisition ? (
        <div className="flex size-full min-h-80 cursor-pointer flex-col items-center justify-center gap-4 overflow-auto p-4 text-center md:px-px">
          <div className="bg-secondary rounded-full p-6">
            <Spinner size="large" />
          </div>
          <Text>{t("alert-processing-account-data-budget")}</Text>
        </div>
      ) : (
        <div className="space-y-6">
          {accounts && accounts.length > 0 && (
            <>
              <div className="space-y-4">
                <Heading variant="h3" className="text-lg font-semibold">
                  {t("existing-accounts")}
                </Heading>
                <Form {...methods}>
                  <form
                    className="w-full space-y-4"
                    onSubmit={handleSubmit(onSubmit)}
                    id="select-budget-account-modal"
                  >
                    <FormField
                      control={methods.control}
                      name="selectedAccounts"
                      render={({ field }) => (
                        <FormItem className="space-y-3">
                          <FormControl>
                            <div className="space-y-3">
                              {accounts.map((account) => {
                                const controlId = `budget-account-${account.accountKey}`;

                                return (
                                  <div
                                    className="hover:bg-muted/50 flex items-center space-x-3 rounded-lg border p-3"
                                    key={account.accountKey}
                                  >
                                    <Checkbox
                                      id={controlId}
                                      checked={field.value.includes(
                                        account.accountKey,
                                      )}
                                      onCheckedChange={() =>
                                        onAccountSelect(account.accountKey)
                                      }
                                    />
                                    <Label
                                      htmlFor={controlId}
                                      className="flex-1 cursor-pointer font-medium"
                                    >
                                      {account.accountName ?? t("unknown")}
                                    </Label>
                                  </div>
                                );
                              })}
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="submit"
                      loading={isSubmitting}
                      disabled={isSubmitting}
                      form="select-budget-account-modal"
                      className="flex justify-self-end"
                    >
                      {t("save")}
                    </Button>
                  </form>
                </Form>
              </div>
            </>
          )}

          <Separator />

          <div className="space-y-4">
            <Heading variant="h3" className="text-lg font-semibold">
              {t("add-new-account")}
            </Heading>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Button
                className="flex h-full flex-1 flex-col items-center justify-start gap-4 p-4 whitespace-normal"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddSyncAccountClick();
                }}
              >
                <div className="bg-background text-primary rounded-full p-2">
                  <Link />
                </div>
                <Heading
                  variant="h3"
                  className="text-primary-foreground text-lg"
                >
                  {t("linked")}
                </Heading>
                <Text variant="smallText" className="text-primary-foreground">
                  {t("add-linked-account-description")}
                </Text>
              </Button>
              <Button
                className="flex h-full flex-1 flex-col items-center justify-start gap-4 p-4 whitespace-normal"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddOfflineAccountClick();
                }}
              >
                <div className="bg-primary rounded-full p-2 text-white">
                  <Unlink />
                </div>
                <Heading variant="h3" className="text-lg">
                  {t("unlinked")}
                </Heading>
                <Text variant="smallText">
                  {t("add-unlinked-account-description")}
                </Text>
              </Button>
            </div>
            <Accordion
              type="single"
              collapsible
              className="bg-background/80 mt-4 rounded-lg border px-3"
            >
              <AccordionItem value="open-banking-info" className="border-b-0">
                <AccordionTrigger className="text-left text-sm font-semibold">
                  {t("faq-open-banking-title")}
                </AccordionTrigger>
                <AccordionContent className="text-foreground text-left">
                  <div className="space-y-3">
                    <OpenBankingNotice />
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </div>
      )}
    </DrawerDialog>
  );
};

export default BudgetAccountSelectModal;

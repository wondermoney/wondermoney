"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";
import { SubmitHandler, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import type { CreditCardSettings } from "@/lib/api/account/useAccounts";
import useEditAccount from "@/lib/api/account/useEditAccount";
import useUpdateCreditCard from "@/lib/api/account/useUpdateCreditCard";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { Switch } from "../ui/switch";

interface AccountEditSheetProps {
  accountName: string;
  accountKey: number;
  isOpen: boolean;
  isOwnedByViewer: boolean;
  isPrivate: boolean;
  /** The card's cycle and limit, or null when the account is not a credit card. */
  creditCard?: CreditCardSettings | null;
  onOpenChange: (open: boolean) => void;
}

const formSchema = z.object({
  accountName: z.string(),
  isPrivate: z.boolean(),
});

type FormSchema = z.infer<typeof formSchema>;

const dayOfMonth = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 31 ? parsed : null;
};

const AccountEditSheet: React.FC<AccountEditSheetProps> = ({
  accountName,
  accountKey,
  isOpen,
  isOwnedByViewer,
  isPrivate,
  creditCard = null,
  onOpenChange,
}) => {
  const t = useTranslations();
  const posthog = usePostHog();
  const methods = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { accountName, isPrivate },
  });
  const {
    handleSubmit,
    formState: { isSubmitting },
  } = methods;
  const editAccountMutation = useEditAccount();
  const updateCreditCard = useUpdateCreditCard();
  const qc = useQueryClient();

  // A card cannot be un-marked: there is no endpoint that removes the cycle, and the account type
  // stays CREDIT_CARD. Once set, the toggle is checked and locked.
  const [isCreditCard, setIsCreditCard] = useState(Boolean(creditCard));
  const [statementCloseDay, setStatementCloseDay] = useState(
    String(creditCard?.statementCloseDay ?? 1),
  );
  const [paymentDueDay, setPaymentDueDay] = useState(
    String(creditCard?.paymentDueDay ?? 1),
  );
  const [creditLimit, setCreditLimit] = useState(
    creditCard?.creditLimit == null ? "" : String(creditCard.creditLimit),
  );
  const [minimumPaymentPercent, setMinimumPaymentPercent] = useState(
    creditCard?.minimumPaymentPercent == null
      ? ""
      : String(creditCard.minimumPaymentPercent),
  );
  const [cardError, setCardError] = useState<string | null>(null);

  const saveCreditCard = async (): Promise<boolean> => {
    const close = dayOfMonth(statementCloseDay);
    const due = dayOfMonth(paymentDueDay);
    if (close === null || due === null) {
      setCardError(t("credit-card-day-invalid"));
      return false;
    }
    const limit = creditLimit.trim() === "" ? null : Number(creditLimit);
    if (limit !== null && (!Number.isFinite(limit) || limit < 0)) {
      setCardError(t("credit-card-limit-invalid"));
      return false;
    }
    const minimum =
      minimumPaymentPercent.trim() === ""
        ? null
        : Number(minimumPaymentPercent);
    if (
      minimum !== null &&
      (!Number.isFinite(minimum) || minimum < 0 || minimum > 100)
    ) {
      setCardError(t("credit-card-minimum-invalid"));
      return false;
    }
    setCardError(null);
    await updateCreditCard.mutateAsync({
      accountKey,
      statementCloseDay: close,
      paymentDueDay: due,
      creditLimit: limit,
      minimumPaymentPercent: minimum,
    });
    return true;
  };

  const onSubmit: SubmitHandler<FormSchema> = async (data) => {
    posthog.capture("account_edited");
    if (isCreditCard) {
      const saved = await saveCreditCard();
      if (!saved) return;
    }
    await editAccountMutation.mutateAsync(
      {
        accountKey,
        accountName: data.accountName,
        // Only the owner may change privacy — omit otherwise so the API's
        // owner-guard doesn't reject a member renaming a shared account.
        isPrivate: isOwnedByViewer ? data.isPrivate : undefined,
      },
      {
        onSettled: async () => {
          await qc.invalidateQueries({ queryKey: ["accounts"], exact: true });
          await qc.invalidateQueries({ queryKey: ["account", accountKey] });
          await qc.invalidateQueries({
            queryKey: ["credit-card-statements", accountKey],
          });
          onOpenChange(false);
        },
        onSuccess: () => toast.success(t("account-updated")),
      },
    );
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t("edit-account")}</SheetTitle>
          <SheetDescription>{t("edit-account-description")}</SheetDescription>
        </SheetHeader>
        <Form {...methods}>
          <form
            className="my-8 w-full"
            onSubmit={handleSubmit(onSubmit)}
            id="edit-account-sheet"
          >
            <FormField
              control={methods.control}
              name="accountName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("name")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("my-account")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {isOwnedByViewer && (
              <FormField
                control={methods.control}
                name="isPrivate"
                render={({ field }) => (
                  <FormItem className="mt-6 flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <FormLabel>{t("private-account")}</FormLabel>
                      <p className="text-muted-foreground text-xs">
                        {t("private-account-description")}
                      </p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}

            <div className="border-border mt-8 border-t pt-6">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <FormLabel>{t("credit-card-account")}</FormLabel>
                  <p className="text-muted-foreground text-xs">
                    {t("credit-card-account-description")}
                  </p>
                </div>
                <Switch
                  aria-label={t("credit-card-account")}
                  checked={isCreditCard}
                  disabled={Boolean(creditCard)}
                  onCheckedChange={setIsCreditCard}
                />
              </div>

              {isCreditCard && (
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <FormLabel required>{t("credit-card-close-day")}</FormLabel>
                    <Input
                      aria-label={t("credit-card-close-day")}
                      max={31}
                      min={1}
                      onChange={(event) =>
                        setStatementCloseDay(event.target.value)
                      }
                      type="number"
                      value={statementCloseDay}
                    />
                  </div>
                  <div className="space-y-2">
                    <FormLabel required>{t("credit-card-due-day")}</FormLabel>
                    <Input
                      aria-label={t("credit-card-due-day")}
                      max={31}
                      min={1}
                      onChange={(event) => setPaymentDueDay(event.target.value)}
                      type="number"
                      value={paymentDueDay}
                    />
                  </div>
                  <div className="space-y-2">
                    <FormLabel>{t("credit-card-limit")}</FormLabel>
                    <Input
                      aria-label={t("credit-card-limit")}
                      min={0}
                      onChange={(event) => setCreditLimit(event.target.value)}
                      placeholder={t("credit-card-limit-placeholder")}
                      step="0.01"
                      type="number"
                      value={creditLimit}
                    />
                  </div>
                  <div className="space-y-2">
                    <FormLabel>{t("credit-card-minimum-payment")}</FormLabel>
                    <Input
                      aria-label={t("credit-card-minimum-payment")}
                      max={100}
                      min={0}
                      onChange={(event) =>
                        setMinimumPaymentPercent(event.target.value)
                      }
                      placeholder={t(
                        "credit-card-minimum-payment-placeholder",
                      )}
                      step="0.01"
                      type="number"
                      value={minimumPaymentPercent}
                    />
                  </div>
                  <p className="text-muted-foreground text-xs sm:col-span-2">
                    {t("credit-card-close-day-description")}
                  </p>
                  {cardError && (
                    <p className="text-destructive-text text-xs sm:col-span-2">
                      {cardError}
                    </p>
                  )}
                </div>
              )}
            </div>
          </form>
        </Form>
        <SheetFooter>
          <Button
            type="submit"
            loading={isSubmitting}
            disabled={isSubmitting}
            form="edit-account-sheet"
          >
            {t("save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default AccountEditSheet;

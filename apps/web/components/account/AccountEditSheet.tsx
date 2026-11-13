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
import { accountAccessErrorKey } from "@/lib/account/access-error-messages";
import {
  initialSharingState,
  sharesRequest,
  sharingChanged,
  type SharingState,
} from "@/lib/account/account-sharing";
import type { CreditCardSettings } from "@/lib/api/account/useAccounts";
import useAccountShares, {
  useUpdateAccountShares,
} from "@/lib/api/account/useAccountShares";
import useEditAccount from "@/lib/api/account/useEditAccount";
import useUpdateCreditCard from "@/lib/api/account/useUpdateCreditCard";
import {
  isDemoReadOnlyError,
  isHouseholdReadOnlyError,
} from "@/lib/api/errors";
import { useHouseholdMembers } from "@/lib/household/useHouseholdMembers";
import { invalidateSpendingTotals } from "@/lib/utils/queryInvalidation";

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
import { AccountSharingField } from "./AccountSharingField";

interface AccountEditSheetProps {
  accountName: string;
  accountKey: number;
  isOpen: boolean;
  /** The caller owns the account (`myAccess` `owner`): only the owner may mark it joint. */
  isOwner?: boolean;
  /** Its spending counts as Shared. Only the owner of a multi-member household sees the switch. */
  isJoint?: boolean;
  /** The card's cycle and limit, or null when the account is not a credit card. */
  creditCard?: CreditCardSettings | null;
  onOpenChange: (open: boolean) => void;
}

const formSchema = z.object({
  accountName: z.string(),
  isJoint: z.boolean(),
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
  isOwner = false,
  isJoint = false,
  creditCard = null,
  onOpenChange,
}) => {
  const t = useTranslations();
  const posthog = usePostHog();
  const { members } = useHouseholdMembers();
  // Attribution only means something with someone to attribute to; the API also refuses it
  // (403 `account_owner_required`) from anyone but the owner.
  const canSetJoint = isOwner && members.length > 1;
  const methods = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { accountName, isJoint },
  });
  const {
    handleSubmit,
    formState: { isSubmitting },
  } = methods;
  const editAccountMutation = useEditAccount();
  const updateCreditCard = useUpdateCreditCard();
  const qc = useQueryClient();

  // Who sees and edits the account. The control starts from the API's answer, once it arrives,
  // and is saved with the rest of the sheet.
  const sharesQuery = useAccountShares(accountKey, { enabled: isOpen });
  const updateShares = useUpdateAccountShares(accountKey);
  const shares = sharesQuery.data;
  const [sharingStart, setSharingStart] = useState<SharingState | null>(null);
  const [sharing, setSharing] = useState<SharingState | null>(null);
  if (shares && sharingStart === null) {
    const start = initialSharingState(shares);
    setSharingStart(start);
    setSharing(start);
  }

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
    const sharesBody =
      shares?.canManage &&
      sharing &&
      sharingStart &&
      sharingChanged(shares.members, sharingStart, sharing)
        ? sharesRequest(shares.members, sharing)
        : null;
    // Sent only when it changed: who the spending belongs to moves every member total.
    const jointChanged = canSetJoint && data.isJoint !== isJoint;
    let step: "account" | "sharing" = "account";
    let accountSaved = false;
    try {
      await editAccountMutation.mutateAsync({
        accountKey,
        accountName: data.accountName,
        ...(jointChanged ? { isJoint: data.isJoint } : {}),
      });
      accountSaved = true;
      if (sharesBody) {
        step = "sharing";
        await updateShares.mutateAsync(sharesBody);
      }
      toast.success(t("account-updated"));
      onOpenChange(false);
    } catch (error) {
      // A viewer's or a view-only member's refusal has its own toast (HouseholdReadOnlyNotifier).
      if (accountAccessErrorKey(error) || isHouseholdReadOnlyError(error))
        return;
      if (isDemoReadOnlyError(error)) {
        toast.error(t("demo-read-only-title"), {
          description: t("demo-read-only-description"),
        });
        return;
      }
      toast.error(
        t(
          step === "sharing"
            ? "accountSharing.save-error"
            : "account-update-error",
        ),
      );
    } finally {
      if (jointChanged && accountSaved) {
        await Promise.all([
          invalidateSpendingTotals(qc),
          qc.invalidateQueries({ queryKey: ["net-worth"] }),
        ]);
      }
      await qc.invalidateQueries({ queryKey: ["accounts"], exact: true });
      await qc.invalidateQueries({ queryKey: ["account", accountKey] });
      await qc.invalidateQueries({
        queryKey: ["credit-card-statements", accountKey],
      });
    }
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
            <AccountSharingField
              shares={shares}
              isLoading={sharesQuery.isLoading}
              isError={sharesQuery.isError}
              state={sharing}
              onChange={setSharing}
              disabled={isSubmitting}
            />
            {canSetJoint && (
              <FormField
                control={methods.control}
                name="isJoint"
                render={({ field }) => (
                  <FormItem className="mt-6 flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <FormLabel>{t("household.attribution.jointAccount")}</FormLabel>
                      <p className="text-muted-foreground text-xs">
                        {t("household.attribution.jointAccountDescription")}
                      </p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={isSubmitting}
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

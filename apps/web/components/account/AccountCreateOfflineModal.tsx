"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useMemo } from "react";
import { SubmitHandler, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { completeOfflineAccountCreation } from "@/lib/account/offline-account-success";
import useAccountTypes, {
  accountTypeTranslationKey,
} from "@/lib/api/account/useAccountTypes";
import useCreateOfflineAccount from "@/lib/api/account/useCreateOfflineAccount";
import useConfigs from "@/lib/api/configs/useConfigs";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import {
  buildCurrencyOptions,
  CURRENCY_TRIGGER_CLASS,
  useAmountPlaceholder,
} from "@/lib/utils/currency-field";
import { zLocaleNumber } from "@/lib/utils/number";
import { invalidateAccounts } from "@/lib/utils/queryInvalidation";

import { Button } from "../ui/button";
import { ComboBoxForm } from "../ui/combobox";
import { VirtualizedCombobox } from "../ui/combobox-virtualized";
import { DrawerDialog } from "../ui/dialog-responsive";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/Select";

interface AccountAddOfflineModalProps {
  isOpen: boolean;
  closeModal: () => void;
  onCancel?: () => void;
  onSuccess?: () => void | Promise<void>;
}

const createFormSchema = (t: (key: string) => string) =>
  z.object({
    name: z.string().min(1, t("invalid-account-name")),
    currencyId: z.string().default("151"),
    // RAD-630: there is no account-type field (checking/savings/credit
    // card/loan) in this form, so a negative balance is the only way a debt
    // account (credit card, loan) can be represented at all — it's what
    // makes Net Worth subtract it instead of adding it as an asset. Zero is
    // still rejected as almost certainly a mistyped/empty entry; the API
    // itself has no positivity constraint (`currentBalance` there is just
    // `z.number().finite().max(999999999999)`), so this mirrors the
    // server's own bound rather than inventing a stricter one.
    currentBalance: zLocaleNumber.pipe(
      z
        .number()
        .finite(t("invalid-current-balance"))
        .max(999999999999, t("invalid-current-balance"))
        .min(-999999999999, t("invalid-current-balance"))
        .refine((value) => value !== 0, {
          message: t("invalid-current-balance"),
        }),
    ),
    financialInstitutionId: z.coerce.number().optional(),
    // RAD-651: optional so existing behaviour (no type recorded) is unchanged
    // for anyone who leaves it unset — the API accepts the create request
    // exactly as it always did when accountTypeId is absent.
    accountTypeId: z.coerce.number().optional(),
  });

type FormSchema = z.infer<ReturnType<typeof createFormSchema>>;

const AccountAddOfflineModal = ({
  isOpen,
  closeModal,
  onCancel,
  onSuccess,
}: AccountAddOfflineModalProps) => {
  const t = useTranslations();
  const amountPlaceholder = useAmountPlaceholder();
  const notifyIfRateLimited = useRateLimitToast();
  const posthog = usePostHog();
  const formSchema = useMemo(() => createFormSchema(t), [t]);
  const methods = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      currencyId: "151",
      name: t("my-account"),
      currentBalance: "",
      financialInstitutionId: undefined,
      accountTypeId: undefined,
    },
  });
  const {
    handleSubmit,
    formState: { isSubmitting },
    reset,
    setError,
    clearErrors,
  } = methods;
  const currencyValue = useWatch({
    name: "currencyId",
    control: methods.control,
  });

  const queryClient = useQueryClient();
  const createOfflineAccountMutation = useCreateOfflineAccount();

  const onSubmit: SubmitHandler<FormSchema> = async (data) => {
    clearErrors("root");
    const accountData = {
      ...data,
      financialInstitutionId: data.financialInstitutionId,
    };
    try {
      await createOfflineAccountMutation.mutateAsync(accountData, {
        onSuccess: async () => {
          await completeOfflineAccountCreation({
            analytics: posthog,
            analyticsProperties: {
              currency: data.currencyId,
              financial_institution: data.financialInstitutionId,
              connection_type: "manual",
            },
            invalidateAccounts: () => invalidateAccounts(queryClient),
            closeModal,
            resetForm: reset,
            notifySuccess: () => toast.success(t("toast-create-account-success")),
            onSuccess,
          });
        },
        onError: (error) => {
          if (notifyIfRateLimited(error)) return;
          setError("root", {
            type: "server",
            message: t("toast-create-account-error"),
          });
          toast.error(t("toast-create-account-error"));
        },
      });
    } catch {
      // mutateAsync rejects after onError; keep the dialog open with values preserved.
    }
  };

  const { data: configsData } = useConfigs();
  const { data: accountTypesData } = useAccountTypes();

  const onOpenChange = (open: boolean) => {
    if (!open) {
      reset();
      closeModal();
      onCancel?.();
    }
  };

  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={onOpenChange}
      title={t("account-details")}
      description={t("account-details-description")}
      footer={
        <Button
          type="submit"
          loading={isSubmitting}
          disabled={isSubmitting}
          form="add-offline-modal"
        >
          {t("create-account")}
        </Button>
      }
    >
      <Form {...methods}>
        <form
          className="w-full space-y-6"
          onSubmit={handleSubmit(onSubmit)}
          id="add-offline-modal"
        >
          <FormField
            control={methods.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("name")}</FormLabel>
                <FormControl>
                  <Input placeholder={t("account-name")} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={methods.control}
            name="financialInstitutionId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("financial-institution")}</FormLabel>
                <FormControl>
                  {configsData?.financialInstitutions && (
                    <VirtualizedCombobox
                      // name={field.name}
                      // ref={field.ref}
                      onSelectOption={(value) => {
                        field.onChange(value);
                      }}
                      searchPlaceholder={t("search-financial-institution")}
                      options={configsData?.financialInstitutions.map(
                        (accountFinancialInstitution) => ({
                          value:
                            accountFinancialInstitution.accountFinancialInstitutionKey.toString(),
                          label: accountFinancialInstitution.displayName,
                          icon: accountFinancialInstitution.logoUrl,
                        }),
                      )}
                    />
                  )}
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={methods.control}
            name="accountTypeId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("account-type")}</FormLabel>
                <Select
                  value={field.value !== undefined ? String(field.value) : undefined}
                  onValueChange={(value) => field.onChange(Number(value))}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={t("account-type-placeholder")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {accountTypesData?.accountTypes.map((accountType) => (
                      <SelectItem
                        key={accountType.accountTypeKey}
                        value={String(accountType.accountTypeKey)}
                      >
                        {t(accountTypeTranslationKey(accountType.description))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={methods.control}
            name="currentBalance"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("current-balance")}</FormLabel>
                <FormControl>
                  <Input
                    type="tel"
                    step="0.01"
                    placeholder={amountPlaceholder}
                    className="w-full pr-4 text-right"
                    {...field}
                    startAdornment={
                      <ComboBoxForm
                        triggerClassName={CURRENCY_TRIGGER_CLASS}
                        field={{ value: currencyValue }}
                        onSelect={(opt) => {
                          methods.setValue("currencyId", opt?.value || "");
                        }}
                        placeholder={t("currency")}
                        options={buildCurrencyOptions(configsData?.currencies)}
                      />
                    }
                  />
                </FormControl>
                <FormDescription>
                  {t("current-balance-debt-hint")}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          {methods.formState.errors.root?.message ? (
            <p className="text-destructive-text text-sm" role="alert">
              {methods.formState.errors.root.message}
            </p>
          ) : null}
        </form>
      </Form>
    </DrawerDialog>
  );
};

export default AccountAddOfflineModal;

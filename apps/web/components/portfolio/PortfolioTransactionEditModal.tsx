"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { SubmitHandler, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import DatePicker from "@/components/ui/DatePicker";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import useConfigs from "@/lib/api/configs/useConfigs";
import { getApiErrorMessage, isDemoReadOnlyError } from "@/lib/api/errors";
import useUpdatePortfolioTransaction from "@/lib/api/portfolio/useUpdatePortfolioTransaction";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import {
  buildCurrencyOptions,
  CURRENCY_TRIGGER_CLASS,
  useAmountPlaceholder,
} from "@/lib/utils/currency-field";
import { zLocaleNumber } from "@/lib/utils/number";

import { Button } from "../ui/button";
import { ComboBoxForm } from "../ui/combobox";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/Select";
import { Spinner } from "../ui/Spinner";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";

interface TransactionData {
  portfolioId: number;
  transactionId: number;
  ticker: string;
  quantity: string;
  unitPrice: string;
  transactionDate: string;
  financialTransactionTypeId: number;
  settlementCurrencyId: number;
  brokerId?: number | null;
  feeAmount?: string | null;
  feeCurrencyId?: number | null;
  originalUnitPrice?: string | null;
  originalCurrencyId?: number | null;
  notes?: string | null;
}

interface PortfolioTransactionEditModalProps {
  isOpen: boolean;
  closeModal: () => void;
  data: TransactionData;
}

const formSchema = z.object({
  transactionDate: z.date(),
  financialTransactionTypeId: z.string(),
  quantity: zLocaleNumber,
  unitPrice: zLocaleNumber,
  settlementCurrencyId: z.string(),
  brokerId: z.string().optional(),
  feeAmount: zLocaleNumber.optional(),
  feeCurrencyId: z.string().optional(),
  originalUnitPrice: zLocaleNumber.optional(),
  originalCurrencyId: z.string().optional(),
  notes: z.string().optional(),
  hasFees: z.boolean().default(false),
  addOriginalCurrency: z.boolean().default(false),
});

type FormProps = z.infer<typeof formSchema>;

const PortfolioTransactionEditModal = (
  props: PortfolioTransactionEditModalProps,
) => {
  const t = useTranslations();
  const amountPlaceholder = useAmountPlaceholder();
  const notifyIfRateLimited = useRateLimitToast();
  const { isOpen, closeModal, data } = props;

  const { data: configsData, isLoading: isLoadingConfigs } = useConfigs();
  const updateMutation = useUpdatePortfolioTransaction();

  const hasFees = data.feeAmount != null && Number(data.feeAmount) > 0;
  const hasOriginalCurrency =
    data.originalUnitPrice != null && Number(data.originalUnitPrice) > 0;
  const selectableTransactionTypes =
    configsData?.financialTransactionTypes.filter(
      (transactionType) =>
        transactionType.name !== "DIVIDEND" ||
        String(transactionType.financialTransactionTypeKey) ===
          String(data.financialTransactionTypeId),
    );

  const [enableFees, setEnableFees] = useState(hasFees);
  const [enableOriginalCurrency, setEnableOriginalCurrency] =
    useState(hasOriginalCurrency);

  const methods = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      transactionDate: new Date(data.transactionDate),
      financialTransactionTypeId: data.financialTransactionTypeId.toString(),
      quantity: String(data.quantity),
      unitPrice: String(data.unitPrice),
      settlementCurrencyId: data.settlementCurrencyId.toString(),
      brokerId: data.brokerId?.toString(),
      feeAmount: data.feeAmount != null ? String(data.feeAmount) : undefined,
      feeCurrencyId: data.feeCurrencyId?.toString(),
      originalUnitPrice:
        data.originalUnitPrice != null
          ? String(data.originalUnitPrice)
          : undefined,
      originalCurrencyId: data.originalCurrencyId?.toString(),
      notes: data.notes ?? "",
      hasFees,
      addOriginalCurrency: hasOriginalCurrency,
    },
  });

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = methods;

  const onSubmit: SubmitHandler<FormProps> = async (formData: any) => {
    const body: Record<string, any> = {
      quantity: formData.quantity,
      unitPrice: formData.unitPrice,
      transactionDate: formData.transactionDate.toISOString(),
      financialTransactionTypeId: formData.financialTransactionTypeId,
      settlementCurrencyId: formData.settlementCurrencyId,
      brokerId: formData.brokerId
        ? Number.parseInt(formData.brokerId, 10)
        : null,
      notes: formData.notes || null,
    };

    if (enableFees) {
      body.feeAmount = formData.feeAmount;
      body.feeCurrencyId = formData.feeCurrencyId;
    } else {
      body.feeAmount = null;
      body.feeCurrencyId = null;
    }

    if (enableOriginalCurrency) {
      body.originalUnitPrice = formData.originalUnitPrice;
      body.originalCurrencyId = formData.originalCurrencyId;
    } else {
      body.originalUnitPrice = null;
      body.originalCurrencyId = null;
    }

    try {
      await updateMutation.mutateAsync(
        {
          portfolioId: data.portfolioId,
          transactionId: data.transactionId,
          body,
        },
        {
          onSuccess: () => {
            toast.success(t("toast-portfolio-edit-transaction-success"), {
              duration: 9000,
            });
            closeModal();
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

            toast.error(
              getApiErrorMessage(error) ??
                t("toast-portfolio-edit-transaction-error"),
              {
                duration: 9000,
              },
            );
          },
        },
      );
    } catch {
      // Error toast is handled by the mutation callback above.
    }
  };

  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) closeModal();
      }}
      title={`${t("edit-transaction")} — ${data.ticker}`}
      footer={
        <Button
          size="lg"
          type="submit"
          loading={isSubmitting}
          disabled={isSubmitting}
          form="edit-portfolio-transaction-form"
        >
          {t("save")}
        </Button>
      }
    >
      <Form {...methods}>
        <form
          className="w-full space-y-4"
          onSubmit={handleSubmit(onSubmit)}
          id="edit-portfolio-transaction-form"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <FormField
              control={control}
              name="transactionDate"
              render={({ field: { onChange, value } }) => (
                <FormItem>
                  <FormLabel className="font-semibold" required>
                    {t("date")}
                  </FormLabel>
                  <FormControl>
                    <DatePicker
                      onSelect={onChange}
                      value={value}
                      disabled={{ after: new Date() }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={control}
              name="financialTransactionTypeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-semibold" required>
                    {t("transaction-type")}
                  </FormLabel>
                  <FormControl>
                    {isLoadingConfigs ? (
                      <Spinner />
                    ) : configsData ? (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={field.disabled}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("transaction-type")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {selectableTransactionTypes?.map(
                              (transactionType) => (
                                <SelectItem
                                  key={
                                    transactionType.financialTransactionTypeKey
                                  }
                                  value={transactionType.financialTransactionTypeKey.toString()}
                                >
                                  {t(
                                    `financial-transaction-type-${transactionType.name}` as any,
                                  )}
                                </SelectItem>
                              ),
                            )}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    ) : null}
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={control}
              name="brokerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-semibold">{t("broker")}</FormLabel>
                  <FormControl>
                    {isLoadingConfigs ? (
                      <Spinner />
                    ) : configsData ? (
                      <Select {...field}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("broker")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {configsData.brokers.map((broker) => (
                              <SelectItem
                                key={broker.financialBrokerKey}
                                value={broker.financialBrokerKey.toString()}
                              >
                                <div className="flex items-center gap-2">
                                  <Image
                                    src={`/logos/brokers/${broker.name}.svg`}
                                    alt={broker.displayName}
                                    width={16}
                                    height={16}
                                    className="size-4"
                                  />
                                  {broker.displayName}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    ) : null}
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <FormField
              control={control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-semibold" required>
                    {t("quantity")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="tel"
                      step="any"
                      placeholder="100"
                      {...field}
                      value={(field.value as string) ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={control}
              name="unitPrice"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required className="font-semibold">
                    {t("unit-price")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="tel"
                      step="any"
                      min="0"
                      placeholder={amountPlaceholder}
                      className="w-full pr-4 text-right"
                      {...field}
                      value={(field.value as string) ?? ""}
                      startAdornment={
                        <ComboBoxForm
                          triggerClassName={CURRENCY_TRIGGER_CLASS}
                          field={{
                            value: methods.watch("settlementCurrencyId"),
                          }}
                          onSelect={(opt) => {
                            methods.setValue(
                              "settlementCurrencyId",
                              opt?.value || "",
                            );
                          }}
                          placeholder={t("currency")}
                          options={buildCurrencyOptions(configsData?.currencies)}
                        />
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={control}
            name="hasFees"
            render={({ field }) => (
              <FormItem className="flex-row items-center gap-2">
                <FormLabel className="m-0 font-semibold">
                  {t("add-fees")}
                </FormLabel>
                <FormControl>
                  <Switch
                    checked={!!field.value}
                    onCheckedChange={(checked) => {
                      field.onChange(checked);
                      setEnableFees(checked);
                    }}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          {enableFees && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <FormField
                control={control}
                name="feeAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required className="font-semibold">
                      {t("fee-amount")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        step="any"
                        min="0"
                        placeholder={amountPlaceholder}
                        className="w-full pr-4 text-right"
                        {...field}
                        value={(field.value as string) ?? ""}
                        startAdornment={
                          <ComboBoxForm
                            triggerClassName={CURRENCY_TRIGGER_CLASS}
                            field={{
                              value: methods.watch("feeCurrencyId"),
                            }}
                            onSelect={(opt) => {
                              methods.setValue(
                                "feeCurrencyId",
                                opt?.value || "",
                              );
                            }}
                            placeholder={t("currency")}
                            options={buildCurrencyOptions(configsData?.currencies)}
                          />
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          <FormField
            control={control}
            name="addOriginalCurrency"
            render={({ field }) => (
              <FormItem className="flex-row items-center gap-2">
                <FormLabel className="m-0 font-semibold">
                  {t("add-original-currency-and-amount")}
                </FormLabel>
                <FormControl>
                  <Switch
                    checked={!!field.value}
                    onCheckedChange={(checked) => {
                      field.onChange(checked);
                      setEnableOriginalCurrency(checked);
                    }}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          {enableOriginalCurrency && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <FormField
                control={control}
                name="originalUnitPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required className="font-semibold">
                      {t("original-price")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        step="any"
                        min="0"
                        placeholder={amountPlaceholder}
                        className="w-full pr-4 text-right"
                        {...field}
                        value={(field.value as string) ?? ""}
                        startAdornment={
                          <ComboBoxForm
                            triggerClassName={CURRENCY_TRIGGER_CLASS}
                            field={{
                              value: methods.watch("originalCurrencyId"),
                            }}
                            onSelect={(opt) => {
                              methods.setValue(
                                "originalCurrencyId",
                                opt?.value || "",
                              );
                            }}
                            placeholder={t("currency")}
                            options={buildCurrencyOptions(configsData?.currencies)}
                          />
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          <FormField
            control={control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-semibold">{t("notes")}</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="e.g. bought right before earnings"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </DrawerDialog>
  );
};

export default PortfolioTransactionEditModal;

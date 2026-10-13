"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Download, Plus } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SubmitHandler, useForm, useWatch } from "react-hook-form";
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
import useCreatePortfolioTransaction from "@/lib/api/portfolio/useCreatePortfolioTransaction";
import usePortfolios from "@/lib/api/portfolio/usePortfolios";
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
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { Textarea } from "../ui/textarea";
import TickerAutoComplete from "../ui/TickerAutoComplete";
import { CertificadoAforroSeriesPicker } from "./CertificadoAforroSeriesPicker";

interface PortfolioTransactionAddModalProps {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  defaultPortfolioId?: string;
  importHref?: string;
  onImportTransactions?: () => void;
  trigger?: React.ReactNode;
}

const createFormSchema = (t: (key: string) => string) =>
  z.object({
    portfolioId: z.string().min(1, t("invalid-portfolio")),
    transactionDate: z.date(),
    financialTransactionTypeId: z.string(),
    brokerId: z.string().optional(),
    assetKind: z.enum(["ticker", "certificado-aforro"]).default("ticker"),
    assetSymbol: z.string(),
    taxExempt: z.boolean().optional(),
    quantity: zLocaleNumber,
    unitPrice: zLocaleNumber,
    settlementCurrencyId: z.string(),
    feeAmount: zLocaleNumber.optional(),
    feeCurrencyId: z.string().optional(),
    originalUnitPrice: zLocaleNumber.optional(),
    originalCurrencyId: z.string().optional(),
    notes: z.string().optional(),
    hasFees: z.boolean().default(false),
    addOriginalCurrency: z.boolean().default(false),
  });

type FormSchema = ReturnType<typeof createFormSchema>;
type FormProps = z.infer<FormSchema>;
export type FormInput = z.input<FormSchema>;
type FormOutput = z.output<FormSchema>;

export function getPortfolioTransactionAddDefaultValues(
  defaultPortfolioId?: string,
  now = new Date(),
): Partial<FormInput> {
  return {
    portfolioId: defaultPortfolioId ?? "",
    transactionDate: now,
    assetKind: "ticker",
    hasFees: false,
    addOriginalCurrency: false,
    settlementCurrencyId: "151",
  };
}

export function createPortfolioTransactionImportHandler(
  closeModal: () => void,
  onImportTransactions: () => void,
  delayMs = 200,
) {
  return () => {
    closeModal();
    globalThis.setTimeout(() => {
      onImportTransactions();
    }, delayMs);
  };
}

const PortfolioTransactionAddModal: React.FC<
  PortfolioTransactionAddModalProps
> = ({
  isOpen,
  setOpen,
  defaultPortfolioId,
  importHref,
  onImportTransactions,
  trigger,
}) => {
  const t = useTranslations();
  const amountPlaceholder = useAmountPlaceholder();
  const notifyIfRateLimited = useRateLimitToast();
  const formSchema = useMemo(() => createFormSchema(t), [t]);

  const { data: configsData, isLoading: isLoadingConfigs } = useConfigs();
  const { data: portfoliosData, isLoading: isLoadingPortfoliosData } =
    usePortfolios();
  const onlyPortfolioId =
    portfoliosData?.portfolios.length === 1
      ? portfoliosData.portfolios[0].portfolioKey.toString()
      : undefined;
  const effectiveDefaultPortfolioId = defaultPortfolioId ?? onlyPortfolioId;
  const autoSelectedPortfolioIdRef = useRef<string | undefined>(
    defaultPortfolioId ? undefined : onlyPortfolioId,
  );

  const getDefaultValues = () =>
    getPortfolioTransactionAddDefaultValues(effectiveDefaultPortfolioId);

  const posthog = usePostHog();
  const methods = useForm<FormInput, undefined, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: getDefaultValues(),
  });
  const {
    control,
    handleSubmit,
    getValues,
    reset,
    setValue,
    formState: { isSubmitting },
  } = methods;

  // Sync defaults when they change after mount (e.g. data load or portfolio creation)
  useEffect(() => {
    const currentPortfolioId = getValues("portfolioId");
    const currentPortfolioIsAvailable = portfoliosData?.portfolios.some(
      (portfolio) => portfolio.portfolioKey.toString() === currentPortfolioId,
    );

    if (defaultPortfolioId) {
      if (
        !currentPortfolioId ||
        currentPortfolioId === autoSelectedPortfolioIdRef.current ||
        !currentPortfolioIsAvailable
      ) {
        setValue("portfolioId", defaultPortfolioId);
      }
      autoSelectedPortfolioIdRef.current = undefined;
      return;
    }

    if (onlyPortfolioId) {
      if (
        !currentPortfolioId ||
        currentPortfolioId === autoSelectedPortfolioIdRef.current ||
        !currentPortfolioIsAvailable
      ) {
        setValue("portfolioId", onlyPortfolioId);
        autoSelectedPortfolioIdRef.current = onlyPortfolioId;
      }
      return;
    }

    if (
      autoSelectedPortfolioIdRef.current &&
      currentPortfolioId === autoSelectedPortfolioIdRef.current
    ) {
      setValue("portfolioId", "");
    }

    autoSelectedPortfolioIdRef.current = undefined;
  }, [
    defaultPortfolioId,
    getValues,
    onlyPortfolioId,
    portfoliosData?.portfolios,
    setValue,
  ]);

  const [enableFees, setEnableFees] = useState(false);
  const [enableOriginalCurrency, setEnableOriginalCurrency] = useState(false);

  const assetKind = useWatch({ control, name: "assetKind" });

  // Reset the shared assetSymbol/taxExempt fields whenever the asset kind
  // toggles, so switching modes never submits a stale value left over from
  // the other mode. Also force unitPrice to 1 and settlementCurrencyId to
  // EUR for CA subscriptions, where "unit price" has no meaning (the
  // quantity field carries the principal) and the certificate is always
  // EUR-nominal — otherwise a currency picked before switching into CA mode
  // (or leaving CA mode with unitPrice still forced to 1) would silently
  // leak into the submitted transaction.
  useEffect(() => {
    setValue("assetSymbol", "");
    setValue("taxExempt", undefined);
    if (assetKind === "certificado-aforro") {
      setValue("unitPrice", 1);
      setValue("settlementCurrencyId", "151");
    } else {
      setValue("unitPrice", "");
    }
  }, [assetKind, setValue]);

  const cleanupModalState = () => {
    reset(getDefaultValues());
    setEnableFees(false);
    setEnableOriginalCurrency(false);
  };

  const closeModal = () => {
    cleanupModalState();
    setOpen(false);
  };

  const handleImportTransactions = onImportTransactions;

  const selectableTransactionTypes =
    configsData?.financialTransactionTypes.filter(
      (transactionType) => transactionType.name !== "DIVIDEND",
    );
  const createTransactionMutation = useCreatePortfolioTransaction();

  const onSubmit: SubmitHandler<FormProps> = async (data) => {
    // assetKind, hasFees and addOriginalCurrency are UI-only fields that
    // drive conditional rendering in this form — none of them are part of
    // the transaction-creation API contract, so they must never reach the
    // mutation body.
    const {
      assetKind: submittedAssetKind,
      hasFees: _hasFees,
      addOriginalCurrency: _addOriginalCurrency,
      ...postData
    } = {
      ...data,
      brokerId: data.brokerId ? Number.parseInt(data.brokerId, 10) : undefined,
    };

    if (!enableFees) {
      delete postData.feeAmount;
      delete postData.feeCurrencyId;
    }
    if (!enableOriginalCurrency) {
      delete postData.originalUnitPrice;
      delete postData.originalCurrencyId;
    }
    if (submittedAssetKind !== "certificado-aforro") {
      delete postData.taxExempt;
    }

    try {
      await createTransactionMutation.mutateAsync(postData, {
        onSuccess: async () => {
          closeModal();
          posthog.capture("portfolio_transaction_added", {
            transaction_type: data.financialTransactionTypeId,
            currency: data.settlementCurrencyId,
            has_fee: enableFees,
          });
          toast.success(t("toast-portfolio-add-transaction-success"), {
            duration: 9000,
          });
          // useCreatePortfolioTransaction's own onSuccess already invalidates
          // every portfolio-detail/dashboard/holdings/metrics/net-worth key
          // via the shared getPortfolioTransactionMutationInvalidationKeys()
          // list (both onSuccess handlers run on every mutation). Repeating
          // a second, hand-picked list here just doubled the number of
          // simultaneous refetches fired on save for no extra coverage —
          // an ad hoc query-key array this file's own conventions warn
          // against (see lib/api/AGENTS.md) and, per RAD-636, a real
          // contributor to totals staying stale after a buy.
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
            getApiErrorMessage(error) ?? t("toast-add-transaction-error"),
            {
              duration: 9000,
            },
          );
        },
      });
    } catch {
      // Error toast is handled by the mutation callback above.
    }
  };

  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          cleanupModalState();
        } else {
          reset(getDefaultValues());
        }
        setOpen(open);
      }}
      trigger={
        trigger !== undefined ? (
          (trigger ?? undefined)
        ) : (
          <Button className="gap-2" size="sm">
            <Plus className="size-4" />
            {t("add-transaction")}
          </Button>
        )
      }
      title={t("add-transaction")}
      footer={
        <>
          {importHref ? (
            <Button asChild className="gap-2" size="lg" variant="ghost">
              <a href={importHref}>
                <Download className="size-4" />
                {t("import-transactions")}
              </a>
            </Button>
          ) : onImportTransactions ? (
            <Button
              className="gap-2"
              size="lg"
              type="button"
              variant="ghost"
              disabled={isSubmitting}
              onClick={handleImportTransactions}
            >
              <Download className="size-4" />
              {t("import-transactions")}
            </Button>
          ) : null}
          <Button
            size="lg"
            type="submit"
            loading={isSubmitting}
            disabled={isSubmitting}
            form="add-portfolio-transaction-form"
          >
            {t("add")}
          </Button>
        </>
      }
    >
      <Form {...methods}>
        <form
          className="w-full space-y-4"
          onSubmit={handleSubmit(onSubmit)}
          id="add-portfolio-transaction-form"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <FormField
              control={control}
              name="portfolioId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-semibold" required>
                    {t("portfolio")}
                  </FormLabel>
                  <FormControl>
                    {isLoadingPortfoliosData ? (
                      <Spinner />
                    ) : portfoliosData ? (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={field.disabled}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("portfolio")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {portfoliosData.portfolios.map((portfolio) => (
                              <SelectItem
                                key={portfolio.portfolioKey}
                                value={portfolio.portfolioKey.toString()}
                              >
                                {portfolio.name}
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

            <FormField
              control={control}
              name="transactionDate"
              render={({ field: { onChange, value } }) => (
                <FormItem>
                  <FormLabel className="font-semibold" required>
                    {assetKind === "certificado-aforro"
                      ? t("portfolio-ca-subscription-date-label")
                      : t("date")}
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
          </div>
          <FormField
            control={control}
            name="assetKind"
            render={({ field: { onChange, value } }) => (
              <FormItem>
                <FormLabel className="font-semibold">
                  {t("portfolio-ca-asset-kind-label")}
                </FormLabel>
                <FormControl>
                  <Tabs value={value} onValueChange={onChange}>
                    <TabsList>
                      <TabsTrigger value="ticker">
                        {t("portfolio-ca-asset-kind-ticker")}
                      </TabsTrigger>
                      <TabsTrigger value="certificado-aforro">
                        {t("portfolio-ca-asset-kind-certificado-aforro")}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
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

            {assetKind === "certificado-aforro" ? (
              <CertificadoAforroSeriesPicker control={control} />
            ) : (
              <FormField
                control={control}
                name="assetSymbol"
                render={({ field: { onChange, value } }) => (
                  <FormItem>
                    <FormLabel className="font-semibold" required>
                      {t("ticker")}
                    </FormLabel>
                    <FormControl>
                      <TickerAutoComplete
                        selectedTicker={value}
                        onTickerSelected={onChange}
                        variant="compact"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <FormField
              control={control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-semibold" required>
                    {assetKind === "certificado-aforro"
                      ? t("portfolio-ca-principal-label")
                      : t("quantity")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="tel"
                      step="any"
                      placeholder="100"
                      {...field}
                      value={field.value == null ? "" : String(field.value)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {assetKind === "certificado-aforro" ? null : (
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
                        value={field.value == null ? "" : String(field.value)}
                        startAdornment={
                          <ComboBoxForm
                            triggerClassName={CURRENCY_TRIGGER_CLASS}
                            field={{
                              value:
                                methods.watch("settlementCurrencyId") ?? "",
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
            )}
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
                        value={field.value == null ? "" : String(field.value)}
                        startAdornment={
                          <ComboBoxForm
                            triggerClassName={CURRENCY_TRIGGER_CLASS}
                            field={{
                              value: methods.watch("feeCurrencyId") ?? "",
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
                        step="0.01"
                        min="0"
                        placeholder={amountPlaceholder}
                        className="w-full pr-4 text-right"
                        {...field}
                        value={field.value == null ? "" : String(field.value)}
                        startAdornment={
                          <ComboBoxForm
                            triggerClassName={CURRENCY_TRIGGER_CLASS}
                            field={{
                              value: methods.watch("originalCurrencyId") ?? "",
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

export default PortfolioTransactionAddModal;

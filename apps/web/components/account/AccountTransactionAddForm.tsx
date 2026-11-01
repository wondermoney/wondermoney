"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ComboBox, ComboBoxForm } from "@/components/ui/combobox";
import { ComboboxCreatable } from "@/components/ui/combobox-creatable";
import DatePicker from "@/components/ui/DatePicker";
import {
  Form,
  FormContent,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Text } from "@/components/ui/Typography";
import {
  createTransactionFormSchema,
  type TransactionFormValues,
} from "@/lib/account/transaction-form-schema";
import { createNewMerchantSelection } from "@/lib/account/transaction-merchant";
import useAccounts, { Account } from "@/lib/api/account/useAccounts";
import { TransactionOCRInfo } from "@/lib/api/account/useCreateTransactionOcr";
import useTransactionMerchants from "@/lib/api/account/useTransactionMerchants";
import useConfigs from "@/lib/api/configs/useConfigs";
import { cn } from "@/lib/utils";
import {
  buildCurrencyOptions,
  CURRENCY_TRIGGER_CLASS,
  useAmountPlaceholder,
} from "@/lib/utils/currency-field";
import { getCurrencySymbol } from "@/lib/utils/currencySymbol";

import { CategoryComboBoxForm } from "../CategoryComboBoxForm";

interface AccountTransactionAddFormProps {
  accounts: Account[];
  ocrData?: TransactionOCRInfo;
  onSubmit: (data: TransactionFormValues) => void;
}

const AccountTransactionAddForm: React.FC<AccountTransactionAddFormProps> = ({
  accounts,
  ocrData,
  onSubmit,
}) => {
  const t = useTranslations();
  const amountPlaceholder = useAmountPlaceholder();
  const formSchema = useMemo(() => createTransactionFormSchema(t), [t]);
  const defaultAccountId =
    accounts.length === 1 ? accounts[0].accountKey.toString() : "";
  const autoSelectedAccountIdRef = useRef<string | undefined>(
    defaultAccountId || undefined,
  );

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      accountId: defaultAccountId,
      transactionDate: ocrData?.transactionDate
        ? new Date(ocrData?.transactionDate)
        : new Date(),
      settlementAmount: ocrData?.settlementAmount
        ? Number(ocrData.settlementAmount)
        : undefined,
      settlementCurrencyId: ocrData?.settlementCurrencyId
        ? String(ocrData.settlementCurrencyId)
        : "151",
      transactionMerchantId: ocrData?.transactionMerchantId
        ? String(ocrData.transactionMerchantId)
        : ocrData?.transactionMerchantName
          ? `[NewMerchant]-${ocrData.transactionMerchantName}`
          : undefined,
      transactionMerchantName: ocrData?.transactionMerchantName ?? "",
      hasOriginalAmount: false,
      originalAmount: undefined,
      originalCurrencyId: undefined,
      exchangeRate: undefined,
      description: "",
      notes: "",
      categoryId: undefined,
    },
  });

  const { control, register, handleSubmit, setValue, getValues } = form;

  useEffect(() => {
    register("settlementCurrencyId");
    register("originalCurrencyId");
  }, [register]);

  const selectedAccount = useWatch({ control, name: "accountId" });
  const watchedSettlementCurrency = useWatch({
    control,
    name: "settlementCurrencyId",
  });
  const selectedCurrency =
    watchedSettlementCurrency === undefined && ocrData?.settlementCurrencyId
      ? String(ocrData.settlementCurrencyId)
      : watchedSettlementCurrency;
  const selectedOriginalCurrency = useWatch({
    control,
    name: "originalCurrencyId",
  });
  const isOriginalAmountChecked = useWatch({
    control,
    name: "hasOriginalAmount",
  });

  const [isOtherDetailsOpen, setIsOtherDetailsOpen] = useState(false);
  const [newMerchantNames, setNewMerchantNames] = useState<string[]>([]);
  const [merchantSearch, setMerchantSearch] = useState("");
  const [debouncedMerchantSearch, setDebouncedMerchantSearch] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedMerchantSearch(merchantSearch);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [merchantSearch]);

  const { data: configsData, isLoading: isLoadingConfigs } = useConfigs();
  const { data: accountsData, isLoading: isLoadingAccountsData } =
    useAccounts();
  const {
    data: transactionMerchantsData,
    isLoading: isLoadingTransactionMerchants,
  } = useTransactionMerchants({
    limit: 20,
    search: debouncedMerchantSearch || undefined,
  });

  const selectableAccounts = accountsData?.accounts ?? accounts;
  const accountsOptions = selectableAccounts.map((account) => ({
    label: account.accountName ?? t("unknown"),
    value: account.accountKey.toString(),
  }));

  useEffect(() => {
    const onlyAccountId =
      accounts.length === 1
        ? accounts[0].accountKey.toString()
        : selectableAccounts.length === 1
          ? selectableAccounts[0].accountKey.toString()
          : undefined;
    const currentAccountId = getValues("accountId");
    const currentAccountIsAvailable = selectableAccounts.some(
      (account) => account.accountKey.toString() === currentAccountId,
    );

    if (onlyAccountId) {
      if (
        !currentAccountId ||
        currentAccountId === autoSelectedAccountIdRef.current ||
        !currentAccountIsAvailable
      ) {
        setValue("accountId", onlyAccountId);
        autoSelectedAccountIdRef.current = onlyAccountId;
      }
      return;
    }

    if (
      autoSelectedAccountIdRef.current &&
      currentAccountId === autoSelectedAccountIdRef.current
    ) {
      setValue("accountId", "");
    }

    autoSelectedAccountIdRef.current = undefined;
  }, [accounts, selectableAccounts, getValues, setValue]);
  const transactionMerchantsOptions =
    transactionMerchantsData?.transactionMerchants
      .map((transactionMerchant) => ({
        label: transactionMerchant.name,
        value: transactionMerchant.transactionMerchantKey.toString(),
      }))
      .concat(
        newMerchantNames.map((merchantName) => ({
          label: merchantName,
          value: `[NewMerchant]-${merchantName}`,
        })),
      )
      .concat(
        !ocrData?.transactionMerchantId && !!ocrData?.transactionMerchantName
          ? [
              {
                label: ocrData.transactionMerchantName,
                value: `[NewMerchant]-${ocrData.transactionMerchantName}`,
              },
            ]
          : [],
      );

  const transactionTypesOptions = configsData?.transactionTypes.map(
    (transactionType) => ({
      label: t(`transaction-type-${transactionType.name}` as any),
      value: transactionType.transactionTypeKey.toString(),
    }),
  );

  const currenciesOptions = configsData?.currencies.map((currency) => ({
    shortLabel: getCurrencySymbol(currency.code),
    label: `${currency.code} (${currency.description})`,
    value: currency.currencyKey.toString(),
    keywords: [currency.code, currency.description],
  }));

  useEffect(() => {
    if (!configsData?.currencies) return;
    const defaultCurrency = configsData?.currencies.find(
      (currency) => currency.code === "EUR",
    );

    const selectedAccountId = getValues("accountId");
    const selectedAccount = accountsData?.accounts.find(
      (account) => account.accountKey.toString() === selectedAccountId,
    );
    if (!selectedAccount) {
      defaultCurrency &&
        setValue(
          "settlementCurrencyId",
          defaultCurrency?.currencyKey.toString(),
        );
      return;
    }

    const currency = configsData?.currencies.find(
      (currency) => currency.code === selectedAccount.currencyKey.code,
    );
    if (!currency) {
      defaultCurrency &&
        setValue(
          "settlementCurrencyId",
          defaultCurrency.currencyKey.toString(),
        );
      return;
    }
    setValue("settlementCurrencyId", currency.currencyKey.toString());
  }, [
    selectedAccount,
    configsData?.currencies,
    accountsData?.accounts,
    getValues,
    setValue,
  ]);

  return (
    <Form {...form}>
      <FormContent
        className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-4"
        onSubmit={handleSubmit(onSubmit)}
        id="add-account-transaction-form"
      >
        <FormField
          control={control}
          name="accountId"
          rules={{ required: true }}
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t("account")}</FormLabel>
              <ComboBoxForm
                field={field}
                onSelect={(opt) => {
                  setValue(field.name, opt?.value || "");
                }}
                placeholder={t("account")}
                options={accountsOptions}
              />
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="transactionDate"
          rules={{ required: true }}
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t("date")}</FormLabel>
              <DatePicker
                form
                inModal
                onSelect={field.onChange}
                value={field.value}
                placeholder={t("transaction-date")}
                disabled={{ after: new Date() }}
              />
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="description"
          render={({ field }) => (
            <FormItem className="col-span-2">
              <FormLabel>{t("description")}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder={t("description")}
                  className="w-full"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="transactionTypeId"
          rules={{ required: true }}
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t("transaction-type")}</FormLabel>
              <ComboBoxForm
                field={field}
                onSelect={(opt) => {
                  setValue(field.name, opt?.value || "");
                }}
                placeholder={t("type")}
                options={transactionTypesOptions}
              />
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="transactionMerchantId"
          rules={{ required: true }}
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t("transaction-merchant")}</FormLabel>
              <ComboboxCreatable
                form={true}
                required
                selected={field.value}
                onChange={(value) => {
                  setValue(field.name, value as string);
                }}
                onCreate={(value) => {
                  const merchant = createNewMerchantSelection(value);

                  if (!merchant) return;

                  setNewMerchantNames([...newMerchantNames, merchant.name]);
                  setValue("transactionMerchantId", merchant.id);
                  setValue("transactionMerchantName", merchant.name);
                }}
                createLabel={(value) =>
                  t("create-merchant", { merchant: value })
                }
                createEmptyHint={t("type-merchant-name-to-create")}
                onQueryChange={setMerchantSearch}
                placeholder={t("transaction-merchant")}
                options={transactionMerchantsOptions}
              />
              <FormMessage role="alert" />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="settlementAmount"
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t("settlement-amount")}</FormLabel>
              <FormControl>
                <Input
                  type="tel"
                  step="0.01"
                  min="0"
                  placeholder={amountPlaceholder}
                  className="w-full pr-4 text-right"
                  {...field}
                  startAdornment={
                    <ComboBoxForm
                      triggerClassName={CURRENCY_TRIGGER_CLASS}
                      field={{ value: selectedCurrency }}
                      onSelect={(opt) => {
                        form.setValue("settlementCurrencyId", opt?.value || "");
                      }}
                      placeholder={t("currency")}
                      options={buildCurrencyOptions(configsData?.currencies)}
                    />
                  }
                />
              </FormControl>
              <FormMessage role="alert" />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="categoryId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("category")}</FormLabel>
              <CategoryComboBoxForm
                categories={configsData?.categories || []}
                field={{ value: field.value }}
                onSelect={(value) => {
                  field.onChange(value);
                }}
              />
              <FormMessage />
            </FormItem>
          )}
        />
        <Collapsible
          open={isOtherDetailsOpen}
          onOpenChange={() => setIsOtherDetailsOpen(!isOtherDetailsOpen)}
          defaultOpen={isOtherDetailsOpen}
          className="col-span-2"
        >
          <CollapsibleTrigger asChild>
            <button type="button" className="text-left">
              <ChevronRight
                className={cn(
                  isOtherDetailsOpen ? "rotate-90" : "",
                  "text-foreground mr-2 inline-block h-5 w-5 shrink-0 transform transition-transform motion-reduce:transition-none",
                )}
                aria-hidden="true"
              />
              <Text variant="smallText">{t("other-details")}</Text>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent asChild className="px-2 pt-2">
            <div className="mb-1 flex flex-col gap-4">
              <FormField
                control={form.control}
                name="hasOriginalAmount"
                render={({ field }) => (
                  <div className="flex flex-row items-center gap-2">
                    <Switch
                      id="original-amount"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                    <Label htmlFor="original-amount">
                      {t("original-currency-amount")}
                    </Label>
                  </div>
                )}
              />
              {isOriginalAmountChecked && (
                <FormField
                  control={form.control}
                  name="originalAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("original-amount")}</FormLabel>
                      <FormControl>
                        <Input
                          type="tel"
                          step="0.01"
                          min="0"
                          placeholder={amountPlaceholder}
                          className="w-full pr-4 text-right"
                          {...field}
                          startAdornment={
                            <ComboBoxForm
                              triggerClassName={CURRENCY_TRIGGER_CLASS}
                              field={{ value: selectedOriginalCurrency }}
                              onSelect={(opt) => {
                                form.setValue(
                                  "originalCurrencyId",
                                  opt?.value || "",
                                );
                              }}
                              placeholder={t("currency")}
                              options={buildCurrencyOptions(
                                configsData?.currencies.filter(
                                  (currency) =>
                                    currency.currencyKey.toString() !==
                                    selectedCurrency,
                                ),
                              )}
                            />
                          }
                        />
                      </FormControl>
                      <FormMessage role="alert" />
                    </FormItem>
                  )}
                />
              )}
              {isOriginalAmountChecked && (
                <FormField
                  control={form.control}
                  name="exchangeRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("exchange-rate")}</FormLabel>
                      <FormControl>
                        <Input
                          type="tel"
                          step="0.0001"
                          min="0"
                          placeholder={t("exchange-rate")}
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("notes")}</FormLabel>
                    <FormControl>
                      <Textarea placeholder={t("notes")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </FormContent>
    </Form>
  );
};

export default AccountTransactionAddForm;

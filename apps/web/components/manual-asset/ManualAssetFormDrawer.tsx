"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import DatePicker from "@/components/ui/DatePicker";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import {
  Form,
  FormContent,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/MoneyInput";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import useCurrencies from "@/lib/api/account/useCurrencies";
import { getApiErrorMessage, isDemoReadOnlyError } from "@/lib/api/errors";
import {
  MANUAL_ASSET_KINDS,
  type ManualAsset,
} from "@/lib/api/manual-asset/types";
import {
  useCreateManualAsset,
  useUpdateManualAsset,
} from "@/lib/api/manual-asset/useManualAssetMutations";
import { calendarDay, dayString } from "@/lib/manual-assets/asset-view";
import {
  formatLocaleNumberInput,
  zLocaleNumber,
  zOptionalLocaleNumber,
} from "@/lib/utils/number";

const FORM_ID = "manual-asset-form";

/** Amounts and the rate are typed in the reader's locale; unreadable input is an error, never another number. */
function buildSchema(
  t: (key: string) => string,
  locale: string,
  invalidAmount: string,
) {
  return z.object({
    name: z.string().trim().min(1, t("validation.required")).max(255),
    kind: z.enum(MANUAL_ASSET_KINDS),
    // Required: an asset is never created in a currency the reader did not see.
    currencyKey: z.coerce
      .number<number | string>({ error: t("validation.required") })
      .int()
      .positive(t("validation.required")),
    value: zLocaleNumber(locale, invalidAmount).pipe(
      z.number().min(0, t("validation.negative")),
    ),
    valuationDate: z.string().min(1, t("validation.required")),
    purchasePrice: zOptionalLocaleNumber(locale, invalidAmount).pipe(
      z.number().min(0, t("validation.negative")).optional(),
    ),
    purchaseDate: z.string().optional(),
    growthRatePercent: zOptionalLocaleNumber(locale, invalidAmount).pipe(
      z
        .number()
        .gt(-100, t("validation.growthRange"))
        .max(1000, t("validation.growthRange"))
        .optional(),
    ),
    growthStartDate: z.string().optional(),
    isPrivate: z.boolean(),
    notes: z.string().max(10_000).optional(),
  });
}

type FormInput = z.input<ReturnType<typeof buildSchema>>;
type FormValues = z.output<ReturnType<typeof buildSchema>>;

/**
 * Add an asset, or edit one. The current value and its date are asked only
 * when adding: afterwards the value changes through "Update value", which
 * keeps the history. The currency is fixed once the asset exists, since every
 * valuation is in it.
 */
export default function ManualAssetFormDrawer({
  open,
  onOpenChange,
  asset,
  userCurrency,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset?: ManualAsset | null;
  /** The currency a new asset starts in: the viewer's own. */
  userCurrency?: string;
  onCreated?: (asset: ManualAsset) => void;
}) {
  const t = useTranslations("assets");
  const tCommon = useTranslations();
  const locale = useLocale();
  const createMutation = useCreateManualAsset();
  const updateMutation = useUpdateManualAsset();
  const { data: currenciesData } = useCurrencies({ enabled: open && !asset });
  const currencies = useMemo(
    () => currenciesData?.currencies ?? [],
    [currenciesData],
  );
  const userCurrencyKey = currencies.find(
    (currency) => currency.code === userCurrency,
  )?.currencyKey;

  const defaultValues = useMemo<FormInput>(
    () => ({
      name: asset?.name ?? "",
      kind: asset?.kind ?? "property",
      // A new asset starts in the viewer's currency once the list has loaded
      // (the effect below); never a guessed one in the meantime.
      currencyKey: asset?.currencyKey ?? "",
      value: asset?.lastValuation?.value ?? "",
      valuationDate: asset?.lastValuation?.date ?? dayString(new Date()),
      purchasePrice: asset?.purchasePrice ?? undefined,
      purchaseDate: asset?.purchaseDate ?? "",
      growthRatePercent: asset?.growthRule?.annualRatePercent ?? undefined,
      growthStartDate: asset?.growthRule?.startDate ?? "",
      isPrivate: asset?.isPrivate ?? false,
      notes: asset?.notes ?? "",
    }),
    [asset],
  );
  const schema = useMemo(
    () => buildSchema(t, locale, tCommon("invalid-amount")),
    [t, tCommon, locale],
  );
  const form = useForm<FormInput, undefined, FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });
  useEffect(() => {
    if (open) form.reset(defaultValues);
  }, [open, defaultValues, form]);
  useEffect(() => {
    if (
      open &&
      !asset &&
      userCurrencyKey !== undefined &&
      !form.getValues("currencyKey")
    )
      form.setValue("currencyKey", userCurrencyKey);
  }, [open, asset, userCurrencyKey, form]);

  const currencyKey = useWatch({ control: form.control, name: "currencyKey" });
  const currencyCode =
    asset?.currency ??
    currencies.find((currency) => currency.currencyKey === Number(currencyKey))
      ?.code;
  // Only the owner decides whether the other member sees the asset.
  const canChangePrivacy = !asset || asset.isOwner;

  const submit = async (values: FormValues) => {
    const shared = {
      name: values.name,
      kind: values.kind,
      purchasePrice: values.purchasePrice ?? null,
      purchaseDate: values.purchaseDate || null,
      growthRule:
        values.growthRatePercent === undefined
          ? null
          : {
              annualRatePercent: values.growthRatePercent,
              startDate: values.growthStartDate || null,
            },
      notes: values.notes?.trim() ? values.notes : null,
      ...(canChangePrivacy ? { isPrivate: values.isPrivate } : {}),
    };
    try {
      if (asset) {
        await updateMutation.mutateAsync({
          manualAssetId: asset.manualAssetKey,
          payload: shared,
        });
      } else {
        const created = await createMutation.mutateAsync({
          ...shared,
          currencyKey: values.currencyKey,
          value: values.value,
          valuationDate: values.valuationDate,
        });
        onCreated?.(created);
      }
      onOpenChange(false);
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(tCommon("demo-read-only-title"), {
          description: tCommon("demo-read-only-description"),
          duration: 9000,
        });
        return;
      }
      toast.error(getApiErrorMessage(error) ?? tCommon("server-error"));
    }
  };

  return (
    <DrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={asset ? t("actions.edit") : t("actions.add")}
      footer={
        <Button
          form={FORM_ID}
          type="submit"
          loading={createMutation.isPending || updateMutation.isPending}
        >
          {asset ? t("actions.save") : t("actions.add")}
        </Button>
      }
    >
      <Form {...form}>
        <FormContent id={FORM_ID} onSubmit={form.handleSubmit(submit)}>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("fields.name")}</FormLabel>
                <FormControl>
                  <Input {...field} placeholder={t("fields.namePlaceholder")} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="kind"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.kind")}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {MANUAL_ASSET_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {t(`kinds.${kind}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          {!asset && (
            <>
              <FormField
                control={form.control}
                name="value"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("fields.value")}</FormLabel>
                    <FormControl>
                      {/* The currency is chosen here, once; the purchase
                          price shows it but does not repeat the picker. */}
                      <MoneyInput
                        {...field}
                        currencyPicker={{
                          value: String(currencyKey),
                          onChange: (value) =>
                            form.setValue("currencyKey", Number(value), {
                              shouldDirty: true,
                            }),
                          options: currencies.map((currency) => ({
                            value: String(currency.currencyKey),
                            label: currency.code,
                          })),
                          label: t("fields.currency"),
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                    {form.formState.errors.currencyKey && (
                      <p className="text-destructive-text text-sm font-medium">
                        {t("fields.currency")}:{" "}
                        {form.formState.errors.currencyKey.message}
                      </p>
                    )}
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="valuationDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel required>{t("fields.valuationDate")}</FormLabel>
                    <DatePicker
                      form
                      inModal
                      disabled={{ after: new Date() }}
                      value={field.value ? calendarDay(field.value) : undefined}
                      onSelect={(date) => field.onChange(dayString(date))}
                      placeholder={t("fields.datePlaceholder")}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}
          <FormField
            control={form.control}
            name="purchasePrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.purchasePrice")}</FormLabel>
                <FormControl>
                  <MoneyInput
                    {...field}
                    currency={currencyCode}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="purchaseDate"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>{t("fields.purchaseDate")}</FormLabel>
                <DatePicker
                  form
                  inModal
                  disabled={{ after: new Date() }}
                  value={field.value ? calendarDay(field.value) : undefined}
                  onSelect={(date) => field.onChange(dayString(date))}
                  placeholder={t("fields.datePlaceholder")}
                />
                {!asset && (
                  <FormDescription>{t("fields.purchaseHint")}</FormDescription>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="growthRatePercent"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.growthRate")}</FormLabel>
                <FormControl>
                  <Input
                    inputMode="decimal"
                    placeholder="0"
                    className="text-right font-mono"
                    endAdornment={<span className="font-mono">%</span>}
                    {...field}
                    value={formatLocaleNumberInput(field.value, locale)}
                  />
                </FormControl>
                <FormDescription>{t("fields.growthRateHint")}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="growthStartDate"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>{t("fields.growthStartDate")}</FormLabel>
                <DatePicker
                  form
                  inModal
                  value={field.value ? calendarDay(field.value) : undefined}
                  onSelect={(date) => field.onChange(dayString(date))}
                  placeholder={t("fields.datePlaceholder")}
                />
                <FormDescription>
                  {t("fields.growthStartDateHint")}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          {canChangePrivacy ? (
            <FormField
              control={form.control}
              name="isPrivate"
              render={({ field }) => (
                <FormItem className="flex-row items-start justify-between gap-4">
                  <div className="space-y-1">
                    <FormLabel className="mb-0">
                      {t("fields.private")}
                    </FormLabel>
                    <p className="text-muted-foreground text-xs">
                      {t("fields.privateDescription")}
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
          ) : (
            <p className="text-muted-foreground text-xs">
              {t("detail.ownerOnlyPrivacy")}
            </p>
          )}
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("fields.notes")}</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    placeholder={t("fields.notesPlaceholder")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormContent>
      </Form>
    </DrawerDialog>
  );
}

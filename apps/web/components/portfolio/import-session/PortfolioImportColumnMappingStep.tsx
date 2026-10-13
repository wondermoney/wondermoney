"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { type Control, Controller, useForm } from "react-hook-form";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import { Button } from "@/components/ui/button";
import { ComboBoxForm } from "@/components/ui/combobox";
import type {
  PortfolioColumnMapping,
  PortfolioColumnMappingTransformations,
  PortfolioCsvLayout,
  PortfolioImportColumnMappingDerivedValues,
  PortfolioImportColumnMappingFixedValues,
  PortfolioImportSupportedCurrencyCode,
} from "@/lib/api/portfolio/importSessionTypes";
import {
  getPortfolioImportColumnFieldsNeedingAttention,
  normalizePortfolioImportColumnValue,
  parsePortfolioImportColumnSourceToken,
  PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE,
  PORTFOLIO_IMPORT_COLUMN_SOURCE_TOKENS,
  type PortfolioImportColumnMappingValidationIssue,
  validatePortfolioImportColumnMapping,
} from "@/lib/portfolio/import-session-column-mapping";

type MappingField = keyof PortfolioColumnMapping;
type FieldKind = "csv" | "currency" | "transactionType";

interface PortfolioImportColumnMappingStepProps {
  availableColumns: string[];
  initialMapping?: Partial<PortfolioColumnMapping>;
  initialFixedValues?: PortfolioImportColumnMappingFixedValues;
  initialDerivedValues?: PortfolioImportColumnMappingDerivedValues;
  initialLayout?: PortfolioCsvLayout;
  initialTransformations?: PortfolioColumnMappingTransformations;
  isSubmitting: boolean;
  hasWarning: boolean;
  recovery?: ReactNode;
  onSubmit: (input: {
    columnMapping: PortfolioColumnMapping;
    derivedValues?: PortfolioImportColumnMappingDerivedValues;
    fixedValues?: PortfolioImportColumnMappingFixedValues;
    layout?: PortfolioCsvLayout;
    transformations?: PortfolioColumnMappingTransformations;
  }) => void | Promise<void>;
}

interface MappingFieldConfig {
  fieldKey: MappingField;
  kind: FieldKind;
  labelKey: string;
  required: boolean;
}

interface PortfolioImportColumnMappingFormValues {
  columnMapping: Record<MappingField, string>;
}

const SUPPORTED_CURRENCIES: PortfolioImportSupportedCurrencyCode[] = [
  "EUR",
  "USD",
  "JPY",
  "GBP",
  "AUD",
  "CAD",
  "CHF",
  "SEK",
  "NOK",
  "BRL",
  "DKK",
];

const MAPPING_FIELDS: MappingFieldConfig[] = [
  {
    fieldKey: "transactionDate",
    kind: "csv",
    labelKey: "portfolio-import-column-transaction-date",
    required: true,
  },
  {
    fieldKey: "quantity",
    kind: "csv",
    labelKey: "portfolio-import-column-quantity",
    required: true,
  },
  {
    fieldKey: "currency",
    kind: "currency",
    labelKey: "portfolio-import-column-currency",
    required: true,
  },
  {
    fieldKey: "transactionType",
    kind: "transactionType",
    labelKey: "portfolio-import-column-transaction-type",
    required: true,
  },
  {
    fieldKey: "unitPrice",
    kind: "csv",
    labelKey: "portfolio-import-column-unit-price",
    required: false,
  },
  {
    fieldKey: "totalAmount",
    kind: "csv",
    labelKey: "portfolio-import-column-total-amount",
    required: false,
  },
  {
    fieldKey: "isin",
    kind: "csv",
    labelKey: "portfolio-import-column-isin",
    required: false,
  },
  {
    fieldKey: "ticker",
    kind: "csv",
    labelKey: "portfolio-import-column-ticker",
    required: false,
  },
  {
    fieldKey: "assetName",
    kind: "csv",
    labelKey: "portfolio-import-column-asset-name",
    required: false,
  },
  {
    fieldKey: "brokerExchange",
    kind: "csv",
    labelKey: "portfolio-import-column-broker-exchange",
    required: false,
  },
  {
    fieldKey: "feeAmount",
    kind: "csv",
    labelKey: "portfolio-import-column-fee-amount",
    required: false,
  },
  {
    fieldKey: "externalTransactionId",
    kind: "csv",
    labelKey: "portfolio-import-column-external-transaction-id",
    required: false,
  },
];

function buildDefaultColumnMapping(
  initialMapping?: Partial<PortfolioColumnMapping>,
  initialFixedValues?: PortfolioImportColumnMappingFixedValues,
  initialDerivedValues?: PortfolioImportColumnMappingDerivedValues,
): Record<MappingField, string> {
  return {
    assetName: initialMapping?.assetName ?? PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE,
    brokerExchange:
      initialMapping?.brokerExchange ?? PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE,
    currency:
      initialFixedValues?.currency
        ? PORTFOLIO_IMPORT_COLUMN_SOURCE_TOKENS.fixedCurrency(initialFixedValues.currency)
        : initialMapping?.currency ?? PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE,
    externalTransactionId:
      initialMapping?.externalTransactionId ?? PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE,
    feeAmount: initialMapping?.feeAmount ?? PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE,
    isin: initialMapping?.isin ?? PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE,
    quantity: initialMapping?.quantity ?? PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE,
    ticker: initialMapping?.ticker ?? PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE,
    totalAmount:
      initialMapping?.totalAmount ?? PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE,
    transactionDate:
      initialMapping?.transactionDate ?? PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE,
    transactionType:
      initialDerivedValues?.transactionType
        ? PORTFOLIO_IMPORT_COLUMN_SOURCE_TOKENS.derivedTransactionType(
            initialDerivedValues.transactionType,
          )
        : initialFixedValues?.transactionType
          ? PORTFOLIO_IMPORT_COLUMN_SOURCE_TOKENS.fixedTransactionType(
              initialFixedValues.transactionType,
            )
          : initialMapping?.transactionType ?? PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE,
    unitPrice: initialMapping?.unitPrice ?? PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE,
  };
}

function buildColumnOptions(columns: string[]) {
  const seen = new Set<string>();

  return columns.flatMap((column) => {
    const value = normalizePortfolioImportColumnValue(column);
    if (!value || seen.has(value)) return [];
    seen.add(value);
    return [{ label: value, value, keywords: [value] }];
  });
}

function buildCurrencyOptions(t: ReturnType<typeof useTranslations>) {
  return SUPPORTED_CURRENCIES.map((currency) => ({
    label: t("portfolio-import-column-use-fixed-currency", { currency }),
    value: PORTFOLIO_IMPORT_COLUMN_SOURCE_TOKENS.fixedCurrency(currency),
    keywords: [currency, t("portfolio-import-column-use-fixed-currency", { currency })],
  }));
}

function buildTransactionTypeOptions(t: ReturnType<typeof useTranslations>) {
  return [
    {
      label: t("portfolio-import-column-derive-from-signed-quantity"),
      value: PORTFOLIO_IMPORT_COLUMN_SOURCE_TOKENS.derivedTransactionType("quantitySign"),
      keywords: ["quantitySign", t("portfolio-import-column-derive-from-signed-quantity")],
    },
    {
      label: t("portfolio-import-column-derive-from-signed-amount"),
      value: PORTFOLIO_IMPORT_COLUMN_SOURCE_TOKENS.derivedTransactionType("totalAmountSign"),
      keywords: ["totalAmountSign", t("portfolio-import-column-derive-from-signed-amount")],
    },
    {
      label: t("portfolio-import-column-use-fixed-buy"),
      value: PORTFOLIO_IMPORT_COLUMN_SOURCE_TOKENS.fixedTransactionType("BUY"),
      keywords: ["BUY", t("portfolio-import-column-use-fixed-buy")],
    },
    {
      label: t("portfolio-import-column-use-fixed-sell"),
      value: PORTFOLIO_IMPORT_COLUMN_SOURCE_TOKENS.fixedTransactionType("SELL"),
      keywords: ["SELL", t("portfolio-import-column-use-fixed-sell")],
    },
  ];
}

function buildFieldOptions(input: {
  availableColumns: string[];
  fieldConfig: MappingFieldConfig;
  t: ReturnType<typeof useTranslations>;
}) {
  const base = [
    {
      label: input.t("portfolio-import-column-not-mapped"),
      value: PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE,
      keywords: [input.t("portfolio-import-column-not-mapped")],
    },
  ];

  if (input.fieldConfig.kind === "currency") {
    return [...base, ...buildCurrencyOptions(input.t), ...buildColumnOptions(input.availableColumns)];
  }

  if (input.fieldConfig.kind === "transactionType") {
    return [
      ...base,
      ...buildTransactionTypeOptions(input.t),
      ...buildColumnOptions(input.availableColumns),
    ];
  }

  return [...base, ...buildColumnOptions(input.availableColumns)];
}

function snapColumnValue(
  value: string | undefined,
  columnsByNormalizedValue: Map<string, string>,
) {
  const normalized = normalizePortfolioImportColumnValue(value ?? "");
  if (!normalized || normalized === PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE) {
    return PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE;
  }

  const sourceToken = parsePortfolioImportColumnSourceToken(normalized);
  if (sourceToken) return normalized;

  return columnsByNormalizedValue.get(normalized) ?? normalized;
}

function isMappedValue(value: string | undefined) {
  return Boolean(value && value !== PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE);
}

function splitColumnMappingSources(values: Record<MappingField, string>) {
  const columnMapping: PortfolioColumnMapping = {};
  const fixedValues: PortfolioImportColumnMappingFixedValues = {};
  const derivedValues: PortfolioImportColumnMappingDerivedValues = {};

  for (const [fieldKey, rawValue] of Object.entries(values) as [
    MappingField,
    string,
  ][]) {
    const sourceToken = parsePortfolioImportColumnSourceToken(rawValue);

    if (!rawValue || rawValue === PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE) continue;

    if (fieldKey === "currency") {
      if (sourceToken?.kind === "fixedCurrency") {
        fixedValues.currency = sourceToken.currency as PortfolioImportSupportedCurrencyCode;
        continue;
      }
      columnMapping.currency = rawValue;
      continue;
    }

    if (fieldKey === "transactionType") {
      if (sourceToken?.kind === "fixedTransactionType") {
        fixedValues.transactionType = sourceToken.transactionType as "BUY" | "SELL";
        continue;
      }

      if (sourceToken?.kind === "derivedTransactionType") {
        derivedValues.transactionType = sourceToken.strategy as "quantitySign" | "totalAmountSign";
        continue;
      }

      columnMapping.transactionType = rawValue;
      continue;
    }

    columnMapping[fieldKey] = rawValue;
  }

  return { columnMapping, fixedValues, derivedValues };
}

function isMissingValue(fieldConfig: MappingFieldConfig, value: string | undefined) {
  return !isMappedValue(value);
}

function MappingFieldRow({
  availableColumns,
  control,
  disabled,
  fieldConfig,
  needsAttention,
}: {
  availableColumns: string[];
  control: Control<PortfolioImportColumnMappingFormValues>;
  disabled: boolean;
  fieldConfig: MappingFieldConfig;
  needsAttention: boolean;
}) {
  const t = useTranslations();
  const options = useMemo(
    () => buildFieldOptions({ availableColumns, fieldConfig, t }),
    [availableColumns, fieldConfig, t],
  );

  return (
    <Controller
      control={control}
      name={`columnMapping.${fieldConfig.fieldKey}` as const}
      render={({ field }) => {
        const missing = isMissingValue(fieldConfig, field.value);
        const missingAttentionField = missing && needsAttention;
        const tone = missingAttentionField
          ? fieldConfig.required
            ? "bg-destructive/5"
            : "bg-warning/5"
          : undefined;
        const triggerTone = missingAttentionField
          ? fieldConfig.required
            ? "border-destructive/30 bg-destructive/5 text-foreground"
            : "border-warning/30 bg-warning/5 text-foreground"
          : undefined;

        return (
          <div
            className={[
              "grid gap-2 rounded-md px-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-3",
              tone,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <ComboBoxForm
              field={field}
              options={options}
              placeholder={t("portfolio-import-column-not-mapped")}
              searchPlaceholder={t("portfolio-import-column-search-placeholder")}
              disabled={disabled}
              triggerClassName={[
                "h-9 w-full min-w-0",
                triggerTone,
                missingAttentionField ? "font-medium" : undefined,
              ]
                .filter(Boolean)
                .join(" ")}
              onSelect={(option) => {
                field.onChange(
                  option?.value ?? PORTFOLIO_IMPORT_COLUMN_NOT_MAPPED_VALUE,
                );
              }}
            />

            <div className="hidden justify-center text-muted-foreground text-xs font-medium uppercase tracking-[0.18em] sm:flex">
              →
            </div>

            <div className="min-w-0">
              <div className="text-foreground text-sm font-medium leading-5">
                {t(fieldConfig.labelKey)}
              </div>
              <div className="text-muted-foreground text-xs">
                {fieldConfig.required
                  ? t("portfolio-import-column-required")
                  : t("portfolio-import-column-optional")}
              </div>
            </div>
          </div>
        );
      }}
    />
  );
}

export function PortfolioImportColumnMappingStep({
  availableColumns,
  initialMapping,
  initialFixedValues,
  initialDerivedValues,
  initialLayout,
  initialTransformations,
  isSubmitting,
  hasWarning,
  recovery,
  onSubmit,
}: PortfolioImportColumnMappingStepProps) {
  const t = useTranslations();
  const [validationMessageKeys, setValidationMessageKeys] = useState<
    PortfolioImportColumnMappingValidationIssue["messageKey"][]
  >([]);

  const availableColumnsByNormalizedValue = useMemo(
    () =>
      new Map(
        availableColumns.map((column) => {
          const normalized = normalizePortfolioImportColumnValue(column);
          return [normalized, normalized] as const;
        }),
      ),
    [availableColumns],
  );

  const defaultValues = useMemo(
    () => ({
      columnMapping: buildDefaultColumnMapping(
        initialMapping,
        initialFixedValues,
        initialDerivedValues,
      ),
    }),
    [initialDerivedValues, initialFixedValues, initialMapping],
  );

  const form = useForm<PortfolioImportColumnMappingFormValues>({ defaultValues });
  const hasEmptyOptions = availableColumns.length === 0;
  const watchedColumnMapping = form.watch("columnMapping");

  const splitWatchedValues = useMemo(
    () => splitColumnMappingSources(watchedColumnMapping),
    [watchedColumnMapping],
  );

  const fieldsNeedingAttention = useMemo(
    () =>
      getPortfolioImportColumnFieldsNeedingAttention({
        columnMapping: splitWatchedValues.columnMapping,
        fieldKeys: MAPPING_FIELDS.map((field) => field.fieldKey),
        fixedValues: splitWatchedValues.fixedValues,
        derivedValues: splitWatchedValues.derivedValues,
        transformations: initialTransformations,
      }),
    [initialTransformations, splitWatchedValues],
  );

  const attentionFields = MAPPING_FIELDS.filter((field) =>
    fieldsNeedingAttention.has(field.fieldKey),
  );
  const matchedFields = MAPPING_FIELDS.filter(
    (field) => !fieldsNeedingAttention.has(field.fieldKey),
  );

  useEffect(() => {
    form.reset(defaultValues);
  }, [defaultValues, form]);

  const handleSubmit = form.handleSubmit(async (values) => {
    const normalizedColumnMapping = Object.fromEntries(
      Object.entries(values.columnMapping).map(([key, value]) => [
        key,
        snapColumnValue(value, availableColumnsByNormalizedValue),
      ]),
    ) as Record<MappingField, string>;

    const splitValues = splitColumnMappingSources(normalizedColumnMapping);

    const validation = validatePortfolioImportColumnMapping({
      columnMapping: splitValues.columnMapping,
      fixedValues: splitValues.fixedValues,
      derivedValues: splitValues.derivedValues,
      transformations: initialTransformations,
    });

    if (!validation.isValid) {
      setValidationMessageKeys(
        validation.missingIssues.map((issue) => issue.messageKey),
      );
      return;
    }

    setValidationMessageKeys([]);

    await onSubmit({
      columnMapping: splitValues.columnMapping,
      fixedValues:
        Object.keys(splitValues.fixedValues).length > 0
          ? splitValues.fixedValues
          : undefined,
      derivedValues:
        Object.keys(splitValues.derivedValues).length > 0
          ? splitValues.derivedValues
          : undefined,
      layout: initialLayout,
      transformations: initialTransformations,
    });
  });

  return (
    <section className="flex flex-col gap-3">
      {recovery}

      <div className="space-y-1">
        <h3
          data-portfolio-import-step-heading="true"
          className="text-foreground text-base font-semibold tracking-tight"
        >
          {t("portfolio-import-column-mapping-title")}
        </h3>
        <p className="text-muted-foreground max-w-2xl text-sm leading-6">
          {t("portfolio-import-column-mapping-description")}
        </p>
      </div>

      {hasWarning ? (
        <Alert>
          <AlertTitle>{t("portfolio-import-column-warning-title")}</AlertTitle>
          <AlertDescription className="text-sm leading-6">
            {t("portfolio-import-column-warning-description")}
          </AlertDescription>
        </Alert>
      ) : null}

      {validationMessageKeys.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>{t("portfolio-import-column-validation-title")}</AlertTitle>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-sm leading-6">
              {validationMessageKeys.map((messageKey) => (
                <li key={messageKey}>{t(messageKey)}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {hasEmptyOptions ? (
        <Alert>
          <AlertTitle>{t("portfolio-import-column-empty-title")}</AlertTitle>
          <AlertDescription>
            {t("portfolio-import-column-empty-description")}
          </AlertDescription>
        </Alert>
      ) : null}

      {attentionFields.length > 0 ? (
        <div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 border-b pb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            <div>{t("portfolio-import-column-source")}</div>
            <div className="text-center">→</div>
            <div>{t("portfolio-import-column-target")}</div>
          </div>

          <div className="divide-y divide-border/60">
            {attentionFields.map((fieldConfig) => (
              <MappingFieldRow
                key={fieldConfig.fieldKey}
                availableColumns={Array.from(
                  availableColumnsByNormalizedValue.values(),
                )}
                control={form.control}
                disabled={isSubmitting}
                fieldConfig={fieldConfig}
                needsAttention
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm leading-6">
          {t("portfolio-import-column-all-matched")}
        </p>
      )}

      {matchedFields.length > 0 ? (
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="matched-fields" className="border-t pt-1">
            <AccordionTrigger className="min-h-11 py-2 text-sm font-medium hover:no-underline">
              {t.rich("portfolio-import-column-more-fields", {
                count: matchedFields.length,
                number: (chunks) => (
                  <span className="font-mono tabular-nums">{chunks}</span>
                ),
              })}
            </AccordionTrigger>
            <AccordionContent>
              <div className="divide-y divide-border/60">
                {matchedFields.map((fieldConfig) => (
                  <MappingFieldRow
                    key={fieldConfig.fieldKey}
                    availableColumns={Array.from(
                      availableColumnsByNormalizedValue.values(),
                    )}
                    control={form.control}
                    disabled={isSubmitting}
                    fieldConfig={fieldConfig}
                    needsAttention={fieldsNeedingAttention.has(fieldConfig.fieldKey)}
                  />
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={handleSubmit}
          loading={isSubmitting}
          disabled={isSubmitting}
        >
          {t("portfolio-import-column-mapping-save")}
        </Button>
      </div>
    </section>
  );
}

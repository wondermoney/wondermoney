"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import type { Control } from "react-hook-form";
import { useFormContext, useWatch } from "react-hook-form";

import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Text } from "@/components/ui/Typography";

import type { FormInput } from "./PortfolioTransactionAddModal";

export const CA_SERIES_OPTIONS = [
  {
    descriptionKey: "portfolio-ca-series-a-description",
    symbol: "CA-SERIE-A",
    valuationMode: "static" as const,
  },
  {
    descriptionKey: "portfolio-ca-series-b-description",
    symbol: "CA-SERIE-B",
    valuationMode: "static" as const,
  },
  {
    descriptionKey: "portfolio-ca-series-c-description",
    symbol: "CA-SERIE-C",
    valuationMode: "accrual" as const,
  },
  {
    descriptionKey: "portfolio-ca-series-d-description",
    symbol: "CA-SERIE-D",
    valuationMode: "accrual" as const,
  },
  {
    descriptionKey: "portfolio-ca-series-e-description",
    symbol: "CA-SERIE-E",
    valuationMode: "accrual" as const,
  },
  {
    descriptionKey: "portfolio-ca-series-f-description",
    symbol: "CA-SERIE-F",
    valuationMode: "accrual" as const,
  },
] as const;

interface CertificadoAforroSeriesPickerProps {
  control: Control<FormInput>;
}

export function CertificadoAforroSeriesPicker({
  control,
}: CertificadoAforroSeriesPickerProps) {
  const t = useTranslations();
  const { setValue } = useFormContext<FormInput>();
  const assetSymbol = useWatch({ control, name: "assetSymbol" });
  const selectedOption = CA_SERIES_OPTIONS.find(
    (option) => option.symbol === assetSymbol,
  );
  const isAccrualSeries = selectedOption?.valuationMode === "accrual";

  // Static-mode series (Séries A/B) have no tax-exemption concept — their
  // value doesn't accrue interest, it's a fixed legacy face value. Clear any
  // stale taxExempt value left over from a previously selected accrual
  // series so it never gets submitted for a static-mode holding.
  useEffect(() => {
    if (selectedOption && selectedOption.valuationMode === "static") {
      setValue("taxExempt", false);
    }
  }, [selectedOption, setValue]);

  return (
    <>
      <FormField
        control={control}
        name="assetSymbol"
        render={({ field: { onChange, value } }) => (
          <FormItem>
            <FormLabel className="font-semibold" required>
              {t("portfolio-ca-series-label")}
            </FormLabel>
            <FormControl>
              <Select onValueChange={onChange} value={value}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("portfolio-ca-series-label")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {CA_SERIES_OPTIONS.map((option) => (
                      <SelectItem key={option.symbol} value={option.symbol}>
                        {t(option.descriptionKey)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {isAccrualSeries ? (
        <FormField
          control={control}
          name="taxExempt"
          render={({ field: { onChange, value } }) => (
            <FormItem className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <FormControl>
                  <Checkbox
                    checked={value ?? false}
                    onCheckedChange={onChange}
                  />
                </FormControl>
                <FormLabel className="m-0 font-normal">
                  {t("portfolio-ca-tax-exempt-label")}
                </FormLabel>
              </div>
              <Text variant="mutedText">
                {t("portfolio-ca-tax-exempt-helper")}
              </Text>
            </FormItem>
          )}
        />
      ) : null}
    </>
  );
}

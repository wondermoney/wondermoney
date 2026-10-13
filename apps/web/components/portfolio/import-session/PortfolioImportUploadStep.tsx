"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { Control } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { FileUploader } from "@/components/ui/FileUploader";
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
import { PORTFOLIO_IMPORT_DEFAULT_MAX_UPLOAD_SIZE_BYTES } from "@/lib/api/portfolio/importSessionTypes";
import type { FinancialBroker } from "@/lib/api/portfolio/useFInancialBrokers";

export interface PortfolioImportUploadStepFormValues {
  brokerId?: string;
  portfolioId?: string;
  portfoliocsv?: File[];
}

export const PORTFOLIO_IMPORT_NO_BROKER_VALUE = "__no_broker__";

interface PortfolioOption {
  name: string;
  portfolioKey: number;
}

interface PortfolioImportUploadStepProps {
  brokers: FinancialBroker[];
  control: Control<PortfolioImportUploadStepFormValues>;
  defaultPortfolioId?: string;
  isLoadingBrokers: boolean;
  isSubmitting: boolean;
  maxUploadSizeBytes?: number;
  onClose: () => void;
  onAnalyze: () => void;
  onFileChange: (files: File[]) => void;
  portfolios: PortfolioOption[];
  recovery?: ReactNode;
}

export function PortfolioImportUploadStep({
  brokers,
  control,
  defaultPortfolioId,
  isLoadingBrokers,
  isSubmitting,
  maxUploadSizeBytes,
  onClose,
  onAnalyze,
  onFileChange,
  portfolios,
  recovery,
}: PortfolioImportUploadStepProps) {
  const t = useTranslations();
  const isPortfolioLocked = Boolean(defaultPortfolioId);
  const effectiveMaxUploadSizeBytes =
    maxUploadSizeBytes ?? PORTFOLIO_IMPORT_DEFAULT_MAX_UPLOAD_SIZE_BYTES;

  return (
    <section className="flex flex-col gap-4">
      {recovery}

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={control}
            name="portfolioId"
            render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>{t("portfolio")}</FormLabel>
                <p className="text-muted-foreground text-xs leading-5">
                  {t("portfolio-import-upload-portfolio-hint")}
                </p>
                <FormControl>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isPortfolioLocked}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("portfolio")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {portfolios.map((portfolio) => (
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
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="brokerId"
            render={({ field }) => (
              <FormItem className="min-w-0">
                <FormLabel>{t("broker")}</FormLabel>
                <p className="text-muted-foreground text-xs leading-5">
                  {t("portfolio-import-upload-broker-hint")}
                </p>
                <FormControl>
                  {isLoadingBrokers ? (
                    <div className="text-muted-foreground text-sm">
                      {t("portfolio-import-upload-broker-loading")}
                    </div>
                  ) : (
                    <Select
                      value={field.value ?? PORTFOLIO_IMPORT_NO_BROKER_VALUE}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("broker")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value={PORTFOLIO_IMPORT_NO_BROKER_VALUE}>
                            {t("portfolio-import-upload-broker-none")}
                          </SelectItem>
                          {brokers.map((broker) => (
                            <SelectItem
                              key={broker.financialBrokerKey}
                              value={broker.financialBrokerKey.toString()}
                            >
                              {broker.displayName}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={control}
          name="portfoliocsv"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("portfolio-import-upload-file-label")}</FormLabel>
              <p className="text-muted-foreground text-xs leading-5">
                {t("portfolio-import-upload-format")}
              </p>
              <FormControl>
                <FileUploader
                  value={field.value}
                  onValueChange={(nextFiles) => {
                    field.onChange(nextFiles);
                    onFileChange(nextFiles);
                  }}
                  maxFileCount={1}
                  maxSize={effectiveMaxUploadSizeBytes}
                  accept={{
                    "text/csv": [".csv"],
                    "application/vnd.ms-excel": [".xls"],
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                      [".xlsx"],
                  }}
                  disabled={isSubmitting}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
        <Button
          variant="secondary"
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
        >
          {t("close")}
        </Button>
        <Button
          type="button"
          onClick={onAnalyze}
          loading={isSubmitting}
          disabled={isSubmitting}
        >
          {t("portfolio-import-upload-analyze")}
        </Button>
      </div>
    </section>
  );
}

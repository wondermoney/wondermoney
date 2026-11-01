"use client";

import { FileDown } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  useReportExport,
  type UseReportExportOptions,
} from "./useReportExport";

// TODO: XLSX export is a follow-up; CSV is sufficient for now. Add
// `ExportXlsxButton` here when the `xlsx` library is pulled in.

interface ExportCsvButtonBaseProps {
  filename: string;
  variant?: "outline" | "ghost";
  size?: "sm" | "default" | "icon";
  className?: string;
  onSuccess?: () => void;
}

interface ExportCsvButtonRowsProps<
  T extends Record<string, unknown>,
> extends ExportCsvButtonBaseProps {
  requestFn: () => Promise<T[]>;
  columns?: string[];
  format?: "rows";
}

interface ExportCsvButtonBlobProps extends ExportCsvButtonBaseProps {
  requestFn: () => Promise<Blob>;
  format: "blob";
}

export type ExportCsvButtonProps<T extends Record<string, unknown>> =
  | ExportCsvButtonRowsProps<T>
  | ExportCsvButtonBlobProps;

export function ExportCsvButton<T extends Record<string, unknown>>(
  props: ExportCsvButtonProps<T>,
) {
  const t = useTranslations("reports.export");
  const {
    requestFn,
    filename,
    variant = "ghost",
    size = "icon",
    className,
    onSuccess,
  } = props;

  const options: UseReportExportOptions<T> = {
    requestFn,
    filename,
    format: props.format,
    onSuccess,
  };

  if (props.format !== "blob") {
    options.columns = (props as ExportCsvButtonRowsProps<T>).columns;
  }

  const { exportData, isPending } = useReportExport(options);

  // Icon-only. Every report card carries one of these, and a full "Export CSV"
  // button repeated down the page is a lot of chrome for a secondary action —
  // on Spending by category it crowded the heading out of its own row. The
  // label lives in `aria-label` (unchanged) and in a tooltip, so nothing is
  // lost for keyboard or screen-reader users.
  //
  // `loading` rather than `disabled` + a hand-rolled spinner: the Button
  // primitive owns that state and also sets `aria-busy`.
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={variant}
            size={size}
            className={cn(
              "text-muted-foreground hover:text-foreground size-8 shrink-0",
              className,
            )}
            onClick={() => void exportData()}
            loading={isPending}
            aria-label={t("csv")}
          >
            {isPending ? null : <FileDown className="size-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("csv")}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

"use client";

import { FileSpreadsheet } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

// XLSX export is a follow-up slice; CSV is sufficient for MVP per RAD-156
// acceptance criteria. This component is a placeholder that renders a disabled
// button so the UI surface can be wired without adding the `xlsx` dependency
// to the bundle.

interface ExportXlsxButtonProps {
  className?: string;
}

export function ExportXlsxButton({ className }: ExportXlsxButtonProps) {
  const t = useTranslations("reports.export");

  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      disabled
      aria-label={t("xlsx")}
    >
      <FileSpreadsheet className="mr-1.5 size-4" />
      {t("xlsx")}
    </Button>
  );
}

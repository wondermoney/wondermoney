"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import { Amount } from "@/components/ui/Amount";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/Label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import type {
  StatementColumns,
  StatementMapping,
  StatementPreview as Preview,
} from "@/lib/api/account/usePreviewAccountCsvImport";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

const NO_COLUMN = "none";

/** A preview date ("2026-01-31") as that calendar day in the reader's time zone. */
const calendarDay = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
};

interface StatementPreviewProps {
  preview: Preview;
  /** The mapping the pickers start from: the preview's own, or the person's edits. */
  mapping?: StatementMapping;
  onMappingChange: (mapping: StatementMapping) => void;
  disabled?: boolean;
  /**
   * The person hid AI. A preview cached from before the switch may still say the
   * columns were found with AI; hide that hint rather than name a feature they turned off.
   */
  aiHidden?: boolean;
}

/**
 * What the file reads as before it is imported: how many transactions over
 * which dates, how the columns were found, the first few rows, and the
 * column pickers to correct it. The pickers open by themselves when the
 * columns could not be found.
 */
export default function StatementPreview({
  preview,
  mapping,
  onMappingChange,
  disabled,
  aiHidden,
}: StatementPreviewProps) {
  const t = useTranslations();
  const formatDate = useFormatShortDate();
  const hasRows = preview.totalRows > 0;

  return (
    <section
      aria-live="polite"
      className="bg-muted flex flex-col gap-4 rounded-md p-4 text-sm"
      data-testid="statement-preview"
    >
      <div className="flex flex-col gap-1">
        {hasRows ? (
          <p className="text-foreground font-medium">
            {t("import-statement-found", { count: preview.totalRows })}
            {preview.firstDate && preview.lastDate
              ? `, ${t("import-statement-range", {
                  from: formatDate(calendarDay(preview.firstDate), {
                    alwaysShowYear: true,
                  }),
                  to: formatDate(calendarDay(preview.lastDate), {
                    alwaysShowYear: true,
                  }),
                })}`
              : null}
          </p>
        ) : null}
        {preview.source === "model" && aiHidden ? null : (
          <p className="text-muted-foreground">
            {preview.source === "bank"
              ? t("import-statement-source-bank", {
                  bank: preview.bankName ?? t("unknown"),
                })
              : t(`import-statement-source-${preview.source}`)}
          </p>
        )}
        {preview.invalidRows > 0 ? (
          <p className="text-muted-foreground">
            {t("import-statement-invalid-rows", { count: preview.invalidRows })}
          </p>
        ) : null}
        {preview.ambiguousDateFormat && hasRows ? (
          <p className="text-muted-foreground">
            {t("import-statement-ambiguous-dates")}
          </p>
        ) : null}
      </div>

      {hasRows ? (
        <table className="w-full table-fixed text-left">
          <thead>
            <tr className="text-muted-foreground">
              <th className="w-28 pb-2 font-normal" scope="col">
                {t("date")}
              </th>
              <th className="pb-2 font-normal" scope="col">
                {t("description")}
              </th>
              <th className="w-28 pb-2 text-right font-normal" scope="col">
                {t("amount")}
              </th>
            </tr>
          </thead>
          <tbody>
            {preview.sample.map((row, index) => (
              <tr key={index} className="border-border border-t">
                <td className="py-2 tabular-nums">
                  {formatDate(calendarDay(row.date), { alwaysShowYear: true })}
                </td>
                <td className="truncate py-2 pr-3">{row.description}</td>
                <td className="py-2 text-right">
                  <Amount
                    value={row.amount}
                    currency={row.currency}
                    tone="delta"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {mapping ? (
        <details className="group" open={preview.source === "none"}>
          <summary className="text-foreground cursor-pointer font-medium">
            {t("import-statement-adjust")}
          </summary>
          <ColumnPickers
            disabled={disabled}
            headers={preview.headers}
            mapping={mapping}
            onChange={onMappingChange}
          />
        </details>
      ) : null}
    </section>
  );
}

function ColumnPickers({
  headers,
  mapping,
  onChange,
  disabled,
}: {
  headers: string[];
  mapping: StatementMapping;
  onChange: (mapping: StatementMapping) => void;
  disabled?: boolean;
}) {
  const t = useTranslations();
  const invertId = useId();
  const splitAmounts =
    mapping.columns.amount === undefined &&
    (mapping.columns.debit !== undefined ||
      mapping.columns.credit !== undefined);

  const setColumn = (field: keyof StatementColumns, value: string) => {
    const columns = { ...mapping.columns };
    if (value === NO_COLUMN) delete columns[field];
    else {
      // A column holds one field: picking it here takes it from wherever it was.
      for (const other of Object.keys(columns) as (keyof StatementColumns)[]) {
        if (columns[other] === Number(value)) delete columns[other];
      }
      columns[field] = Number(value);
    }
    onChange({ ...mapping, columns });
  };

  const setAmountLayout = (layout: string) => {
    const { amount, debit, credit, direction, ...rest } = mapping.columns;
    const columns: StatementColumns =
      layout === "two"
        ? { ...rest, debit: debit ?? amount, credit }
        : { ...rest, amount: amount ?? debit ?? credit, direction };
    onChange({ ...mapping, columns });
  };

  const column = (field: keyof StatementColumns, optional = false) => (
    <Picker
      disabled={disabled}
      label={t(`import-statement-column-${field}`)}
      value={
        mapping.columns[field] === undefined
          ? NO_COLUMN
          : String(mapping.columns[field])
      }
      onValueChange={(value) => setColumn(field, value)}
      options={[
        ...(optional ? [{ label: t("none"), value: NO_COLUMN }] : []),
        ...headers.map((header, index) => ({
          label: header,
          value: String(index),
        })),
      ]}
      placeholder={t("import-statement-pick-column")}
    />
  );

  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      {column("date")}
      {column("description")}
      <Picker
        disabled={disabled}
        label={t("import-statement-amount-layout")}
        value={splitAmounts ? "two" : "one"}
        onValueChange={setAmountLayout}
        options={[
          { label: t("import-statement-amount-one"), value: "one" },
          { label: t("import-statement-amount-two"), value: "two" },
        ]}
      />
      {splitAmounts ? (
        <>
          {column("debit", true)}
          {column("credit", true)}
        </>
      ) : (
        column("amount")
      )}
      <Picker
        disabled={disabled}
        label={t("import-statement-date-format")}
        value={mapping.dateFormat}
        onValueChange={(value) =>
          onChange({
            ...mapping,
            dateFormat: value as StatementMapping["dateFormat"],
          })
        }
        options={[
          { label: t("import-statement-date-dmy"), value: "DMY" },
          { label: t("import-statement-date-mdy"), value: "MDY" },
          { label: t("import-statement-date-ymd"), value: "YMD" },
        ]}
      />
      <Picker
        disabled={disabled}
        label={t("import-statement-number-format")}
        value={mapping.decimalSeparator}
        onValueChange={(value) =>
          onChange({
            ...mapping,
            decimalSeparator: value as StatementMapping["decimalSeparator"],
          })
        }
        options={[
          { label: "1.234,56", value: "," },
          { label: "1,234.56", value: "." },
        ]}
      />
      <div className="flex items-center gap-3 sm:col-span-2">
        <Checkbox
          id={invertId}
          checked={mapping.invertAmounts}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange({ ...mapping, invertAmounts: checked === true })
          }
        />
        <Label htmlFor={invertId} className="font-normal">
          {t("import-statement-invert")}
        </Label>
      </div>
    </div>
  );
}

function Picker({
  label,
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { label: string; value: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={
          value === NO_COLUMN &&
          !options.some((option) => option.value === NO_COLUMN)
            ? undefined
            : value
        }
        onValueChange={onValueChange}
        disabled={disabled}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

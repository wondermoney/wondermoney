// "Read my invoice" in the electricity tariff comparator: the visitor chooses the supplier's PDF,
// the browser extracts its text (lib/calculators/invoicePdf.ts loads pdf.js only then) and
// lib/calculators/electricityInvoice.ts reads the figures. The visitor sees what was read and
// fills the form with it, or discards it; the form changes only on "Fill in the form", and an
// invoice the reader cannot use leaves it as it was. The file never leaves the device.
import { FileUp, Lock } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { k, PERIOD_KEYS } from "./ElectricityTariffResults";
import {
  INVOICE_LAYOUTS,
  readElectricityInvoice,
  type InvoiceField,
  type InvoiceReading,
} from "@/lib/calculators/electricityInvoice";
import { supplierName } from "@/lib/calculators/electricitySuppliers";
import { InvoicePdfError, readInvoicePdfLines, type InvoicePdfErrorCode } from "@/lib/calculators/invoicePdf";
import { formatNumber } from "@/lib/numberFormat";
import { useTranslations } from "@/lib/reactTranslations";

/** Larger than any invoice; a bigger file is not read. */
const MAX_FILE_MB = 15;

type ErrorCode = InvoicePdfErrorCode | "unsupported" | "noElectricity" | "tooLarge";

type State =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "error"; code: ErrorCode }
  | { state: "review"; reading: InvoiceReading }
  | { state: "applied" };

const i = (key: string) => k(`invoice.${key}`);

export default function ElectricityInvoiceUpload({
  onApply,
  readLines = readInvoicePdfLines,
}: {
  onApply: (reading: InvoiceReading) => void;
  /** The PDF's text lines; a prop so tests can skip pdf.js. */
  readLines?: (data: Uint8Array) => Promise<string[]>;
}) {
  const { t, locale } = useTranslations();
  const [status, setStatus] = useState<State>({ state: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(0);

  const suppliers = new Intl.ListFormat(locale, { type: "conjunction" }).format(
    INVOICE_LAYOUTS.map((layout) => supplierName(layout.supplier)),
  );

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    const request = ++latest.current;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setStatus({ state: "error", code: "tooLarge" });
      return;
    }
    setStatus({ state: "reading" });
    let next: State;
    try {
      const lines = await readLines(new Uint8Array(await file.arrayBuffer()));
      const result = readElectricityInvoice(lines);
      next = result.ok ? { state: "review", reading: result.reading } : { state: "error", code: result.reason };
    } catch (error) {
      next = { state: "error", code: error instanceof InvoicePdfError ? error.code : "unreadable" };
    }
    if (request === latest.current) setStatus(next);
  };

  const clearFile = () => {
    if (input.current) input.current.value = "";
  };

  return (
    <section aria-labelledby="tariff-invoice-title" className="space-y-3">
      <label
        className="flex cursor-pointer items-center gap-3 rounded-card border border-dashed border-input bg-background p-4 transition-colors hover:border-primary/60 hover:bg-paper-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2"
      >
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <FileUp className="size-5" />
        </span>
        <span className="min-w-0">
          <span id="tariff-invoice-title" className="block text-sm font-semibold text-foreground">
            {t(i("title"))}
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Lock aria-hidden="true" className="size-3 shrink-0" />
            {t(i("privacyShort"))}
          </span>
        </span>
        <input
          ref={input}
          id="tariff-invoice"
          type="file"
          accept="application/pdf,.pdf"
          aria-label={t(i("label"))}
          aria-describedby="tariff-invoice-help tariff-invoice-privacy"
          onChange={(event) => readFile(event.currentTarget.files?.[0])}
          className="sr-only"
        />
      </label>
      {/* What the visible line leaves out, for screen readers: the suppliers read and the privacy note. */}
      <span id="tariff-invoice-help" className="sr-only">
        {t(i("intro"))} {t(i("supported"), { suppliers })}
      </span>
      <span id="tariff-invoice-privacy" className="sr-only">
        {t(i("privacy"))}
      </span>
      {status.state === "reading" && (
        <p role="status" className="text-sm text-foreground">
          {t(i("reading"))}
        </p>
      )}
      {status.state === "error" && (
        <p role="alert" className="rounded-lg border border-warning-text/40 px-4 py-3 text-sm text-foreground">
          {t(i(`errors.${status.code}`), { max: String(MAX_FILE_MB), suppliers })}
        </p>
      )}
      {status.state === "review" && (
        <InvoiceReview
          reading={status.reading}
          onApply={() => {
            onApply(status.reading);
            setStatus({ state: "applied" });
          }}
          onDiscard={() => {
            clearFile();
            setStatus({ state: "idle" });
          }}
        />
      )}
      {status.state === "applied" && (
        <p role="status" className="rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">
          {t(i("applied"))}
        </p>
      )}
    </section>
  );
}

function InvoiceReview({ reading, onApply, onDiscard }: { reading: InvoiceReading; onApply: () => void; onDiscard: () => void }) {
  const { t, locale } = useTranslations();
  const option = reading.option?.value ?? "simple";
  const periodName = (index: number) => t(k(`periods.${PERIOD_KEYS[option][index]}`));
  const decimals = (value: number) => formatNumber(locale, value, 4);

  const rows: { key: string; label: string; value: string; field: InvoiceField<unknown> }[] = [];
  const add = (key: string, label: string, value: string, field: InvoiceField<unknown>) => rows.push({ key, label, value, field });
  if (reading.contractedPower) add("power", t(i("fields.power")), `${formatNumber(locale, reading.contractedPower.value, 2)} kVA`, reading.contractedPower);
  if (reading.option) add("option", t(i("fields.option")), t(k(`options.${reading.option.value}`)), reading.option);
  if (reading.cycle) add("cycle", t(i("fields.cycle")), t(k(`cycles.${reading.cycle.value}`)), reading.cycle);
  if (reading.periodDays) add("days", t(i("fields.days")), formatNumber(locale, reading.periodDays.value, 0), reading.periodDays);
  reading.kwhByPeriod?.value.forEach((kwh, index) =>
    add(
      `kwh${index}`,
      option === "simple" ? t(i("fields.kwhSimple")) : t(i("fields.kwh"), { period: periodName(index) }),
      `${formatNumber(locale, kwh, 0)} kWh`,
      reading.kwhByPeriod as InvoiceField<unknown>,
    ),
  );
  const prices = reading.prices;
  if (prices?.value.powerPerDay !== undefined) {
    add("powerPrice", t(i("fields.powerPrice")), `${decimals(prices.value.powerPerDay)} ${t(k("myTariff.powerUnit"))}`, prices);
  }
  prices?.value.energy?.forEach((price, index) =>
    add(
      `energyPrice${index}`,
      option === "simple" ? t(i("fields.energyPriceSimple")) : t(i("fields.energyPrice"), { period: periodName(index) }),
      `${decimals(price)} €/kWh`,
      prices,
    ),
  );
  const anyToCheck = rows.some((row) => row.field.confidence !== "high");
  const supplier = reading.supplier ? supplierName(reading.supplier.value) : "";

  return (
    <div aria-live="polite" className="space-y-3 rounded-lg bg-paper-2 px-4 py-3 text-sm text-foreground">
      <p className="font-medium">{t(i("found"), { supplier })}</p>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5">
        {rows.map((row) => (
          <div key={row.key} className="contents">
            <dt className="text-ink-2">{row.label}</dt>
            <dd className="text-right">
              <span className="font-mono">{row.value}</span>
              {row.field.confidence !== "high" && (
                <span className="ml-2 rounded-[4px] bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-warning-text">{t(i("check"))}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {anyToCheck && <p className="text-xs text-muted-foreground">{t(i("checkHelp"))}</p>}
      <p className="text-xs text-muted-foreground">{t(i("notes"))}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onApply}>
          {t(i("apply"))}
        </Button>
        <Button type="button" variant="secondary" onClick={onDiscard}>
          {t(i("discard"))}
        </Button>
      </div>
    </div>
  );
}

import { BANK_ACCOUNTS_SOURCE, DEPOSIT_GUARANTEE } from "@/lib/calculators/data/bankAccountsSource";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatMonth } from "@/lib/numberFormat";
import { useTranslations } from "@/lib/reactTranslations";

const s = (key: string) => `tools.bankAccountsShared.${key}`;

/** "19 nov. 2026": composed from the short month name, like formatMonthYear, so it hydrates. */
export function formatAsOfDate(locale: Lang, iso: string = BANK_ACCOUNTS_SOURCE.asOf): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return `${date.getUTCDate()} ${formatMonth(locale, date)} ${date.getUTCFullYear()}`;
}

/** The as-of date, prominently, with the source note and "conditions change". */
export function AsOfBanner() {
  const { t, locale } = useTranslations();
  return (
    <section
      aria-labelledby="bank-accounts-as-of"
      className="rounded-card border border-border bg-paper-2 p-5 sm:p-6"
    >
      <p id="bank-accounts-as-of" className="text-lg font-semibold text-foreground sm:text-xl">
        {t(s("asOf"), { date: formatAsOfDate(locale) })}
      </p>
      <p className="mt-2 text-sm text-foreground">{t(s("confirm"))}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t(s("source"))}</p>
    </section>
  );
}

/** Educational-only statement, deposit guarantee and tax treatment of foreign banks. */
export function BankNotices() {
  const { t, locale } = useTranslations();
  return (
    <section aria-labelledby="bank-notices-title" className="mt-12 grid gap-4 md:grid-cols-3">
      <h2 id="bank-notices-title" className="sr-only">
        {t(s("noticesTitle"))}
      </h2>
      <div className="rounded-card border border-border bg-background p-5 shadow-sm">
        <h3 className="text-base font-semibold text-foreground">{t(s("educationalTitle"))}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{t(s("educational"))}</p>
      </div>
      <div className="rounded-card border border-border bg-background p-5 shadow-sm">
        <h3 className="text-base font-semibold text-foreground">{t(s("guarantee.title"))}</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(s("guarantee.body"), {
            amount: formatMoney(locale, DEPOSIT_GUARANTEE.amount, { currency: "EUR", decimals: 0 }),
          })}
        </p>
        <p className="mt-2 text-sm">
          <a
            href={DEPOSIT_GUARANTEE.url}
            rel="noopener"
            target="_blank"
            className="font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80"
          >
            {t(s("guarantee.link"))}
          </a>
        </p>
      </div>
      <div className="rounded-card border border-border bg-background p-5 shadow-sm">
        <h3 className="text-base font-semibold text-foreground">{t(s("foreignTax.title"))}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{t(s("foreignTax.body"))}</p>
      </div>
    </section>
  );
}

/** The table's own notes, verbatim in Portuguese, labelled as the original conditions elsewhere. */
export function OriginalNotes({
  notes,
  className = "",
  showLabel = true,
}: {
  notes: readonly string[];
  className?: string;
  showLabel?: boolean;
}) {
  const { t, locale } = useTranslations();
  if (notes.length === 0) return null;
  return (
    <div className={className}>
      {showLabel && locale !== "pt" && <p className="text-xs font-medium text-muted-foreground">{t(s("originalLabel"))}</p>}
      <ul lang="pt" className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-foreground">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  );
}

export function YesMark({ value }: { value: boolean }) {
  const { t } = useTranslations();
  return value ? (
    <span role="img" aria-label={t(s("yes"))} className="text-primary">
      ✔
    </span>
  ) : (
    <span className="text-muted-foreground">
      <span aria-hidden="true">–</span>
      <span className="sr-only">{t(s("no"))}</span>
    </span>
  );
}

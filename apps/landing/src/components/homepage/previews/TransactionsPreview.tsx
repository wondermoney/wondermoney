import { useTranslations } from "@/lib/reactTranslations";
import { usePreviewFormat } from "@/lib/usePreviewFormat";

export default function TransactionsPreview() {
  const { t } = useTranslations();
  const fmt = usePreviewFormat();
  const sampleTransactions = [
    { merchant: "Pingo Doce", amount: fmt.money(-47.3, { decimals: 2 }), catKey: "preview.categories.groceries", color: "bg-chart-3/10 text-chart-3" },
    { merchant: "Carris Metropolitana", amount: fmt.money(-1.6, { decimals: 2 }), catKey: "preview.categories.transport", color: "bg-primary/10 text-primary" },
    { merchant: "NOS Comunicações", amount: fmt.money(-29.99, { decimals: 2 }), catKey: "preview.categories.utilities", color: "bg-warning/10 text-warning-text" },
    { merchant: "Salário, Acme Lda", amount: fmt.money(2800, { decimals: 2, sign: "always" }), catKey: "preview.categories.income", color: "bg-success/10 text-success-text", positive: true },
    { merchant: "IKEA Portugal", amount: fmt.money(-84.5, { decimals: 2 }), catKey: "preview.categories.home", color: "bg-info/10 text-info-text" },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-6">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{t("preview.transactions.title")}</span>
      </div>
      <div className="mt-4 space-y-2">
        {sampleTransactions.map((tx) => (
          <div
            key={tx.merchant}
            className="flex items-center justify-between rounded-xl border border-border bg-muted/60 px-4 py-2.5"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${tx.color}`}>
                {t(tx.catKey)}
              </span>
              <span className="truncate text-sm text-ink-2">{tx.merchant}</span>
            </div>
            <span className={`ml-3 shrink-0 font-mono text-sm font-semibold ${tx.positive ? "text-success-text" : "text-foreground"}`}>
              {tx.amount}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 border-t border-border pt-3 text-[11px] text-muted-foreground">
        {t("preview.transactions.syncNote")}
      </div>
    </div>
  );
}

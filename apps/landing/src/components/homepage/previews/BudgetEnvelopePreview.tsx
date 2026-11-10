import { useTranslations } from "@/lib/reactTranslations";
import { usePreviewFormat } from "@/lib/usePreviewFormat";

export default function BudgetEnvelopePreview() {
  const { t } = useTranslations();
  const fmt = usePreviewFormat();
  const envelopes = [
    { nameKey: "preview.categories.housing", assigned: 1200, total: 1500, color: "bg-chart-1" },
    { nameKey: "preview.categories.groceries", assigned: 320, total: 400, color: "bg-chart-2" },
    { nameKey: "preview.categories.transport", assigned: 85, total: 150, color: "bg-chart-5" },
    { nameKey: "preview.categories.entertainment", assigned: 60, total: 100, color: "bg-ink-2" },
    { nameKey: "preview.categories.savings", assigned: 300, total: 300, color: "bg-success" },
  ];

  const totalAssigned = envelopes.reduce((s, e) => s + e.assigned, 0);

  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-6">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{t("preview.envelope.title")}</span>
      </div>
      {/* Income summary */}
      <div className="mt-4 rounded-xl bg-muted px-4 py-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t("preview.envelope.income")}</span>
          <span className="font-mono font-semibold text-foreground">{fmt.money(2800, { decimals: 2 })}</span>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
          <span>{t("preview.envelope.assigned")}</span>
          <span className="font-mono font-semibold text-foreground">{fmt.money(totalAssigned, { decimals: 2 })}</span>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{t("preview.envelope.leftToAssign")}</span>
          <span className="font-mono font-semibold text-success-text">
            {fmt.money(2800 - totalAssigned, { decimals: 2 })}
          </span>
        </div>
      </div>
      {/* Envelopes */}
      <div className="mt-4 space-y-3">
        {envelopes.map((env) => {
          const pct = Math.min((env.assigned / env.total) * 100, 100);
          const remaining = env.total - env.assigned;
          return (
            <div key={env.nameKey} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-ink-2">{t(env.nameKey)}</span>
                <span className="font-mono text-muted-foreground">
                  {fmt.money(remaining)} {t("preview.envelope.left")}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted">
                <div className={`h-1.5 rounded-full ${env.color}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

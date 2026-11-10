import { useTranslations } from "@/lib/reactTranslations";
import { TrendingUp, ArrowUpRight, ArrowDownRight } from "lucide-react";
import type { Translate } from "@/lib/translations";

/* ─── Accounts variant (app-financas-portugal) ─── */

function getSampleAccounts(t: Translate) {
    return [
        { name: t("lp.preview.accounts.account1"), balance: "€3,240.50", tone: "text-success-text" },
        { name: t("lp.preview.accounts.account2"), balance: "€12,800.00", tone: "text-success-text" },
        { name: t("lp.preview.accounts.account3"), balance: "-€480.20", tone: "text-destructive-text" },
    ];
}

function AccountsVariant() {
    const { t } = useTranslations();
    const sampleAccounts = getSampleAccounts(t);

    return (
        <div className="rounded-card border border-border bg-background px-5 py-6 shadow-md">
            <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{t("lp.preview.accounts.heading")}</span>
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                    {t("lp.preview.accounts.liveBadge")}
                </span>
            </div>
            <div className="mt-5 space-y-3">
                {sampleAccounts.map((account) => (
                    <div
                        key={account.name}
                        className="flex items-center justify-between rounded-xl border border-border bg-paper-2/60 px-4 py-3"
                    >
                        <span className="text-sm font-medium text-foreground">{account.name}</span>
                        <span className={`font-mono text-sm font-semibold ${account.tone}`}>
                            {account.balance}
                        </span>
                    </div>
                ))}
            </div>
            <div className="mt-4 border-t border-border pt-3">
                <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t("lp.preview.accounts.netWorthLabel")}</span>
                    <span className="font-mono text-base font-bold text-foreground">€15,560.30</span>
                </div>
                <div className="mt-1 flex items-center gap-1 text-xs text-success-text">
                    <ArrowUpRight className="h-3 w-3" />
                    <span>{t("lp.preview.accounts.monthChangeLabel")}</span>
                </div>
            </div>
        </div>
    );
}

/* ─── Budget variant (controlo-gastos) ─── */

function getSampleBudgets(t: Translate) {
    return [
        { name: t("lp.preview.categories.food"), spent: 280, budget: 400, color: "bg-chart-1" },
        { name: t("lp.preview.categories.transport"), spent: 95, budget: 120, color: "bg-chart-2" },
        { name: t("lp.preview.categories.leisure"), spent: 150, budget: 150, color: "bg-chart-5" },
        { name: t("lp.preview.categories.shopping"), spent: 60, budget: 200, color: "bg-ink-2" },
    ];
}

function BudgetVariant() {
    const { t } = useTranslations();
    const sampleBudgets = getSampleBudgets(t);
    const totalSpent = sampleBudgets.reduce((s, b) => s + b.spent, 0);
    const totalBudget = sampleBudgets.reduce((s, b) => s + b.budget, 0);

    return (
        <div className="rounded-card border border-border bg-background px-5 py-6 shadow-md">
            <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{t("lp.preview.budget.heading")}</span>
                <span className="rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success-text">
                    {t("lp.preview.budget.onTrackBadge")}
                </span>
            </div>
            <div className="mt-5 space-y-4">
                {sampleBudgets.map((b) => {
                    const pct = Math.min((b.spent / b.budget) * 100, 100);
                    const isOver = b.spent >= b.budget;
                    return (
                        <div key={b.name} className="space-y-1.5">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-medium text-foreground">{b.name}</span>
                                <span className={`font-mono text-xs font-medium ${isOver ? "text-warning-text" : "text-muted-foreground"}`}>
                                    €{b.spent} / €{b.budget}
                                </span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-paper-2">
                                <div
                                    className={`h-2 rounded-full ${isOver ? "bg-chart-2" : b.color}`}
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="mt-4 border-t border-border pt-3">
                <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t("lp.preview.budget.remainingLabel")}</span>
                    <span className="font-mono text-base font-bold text-success-text">
                        €{totalBudget - totalSpent}
                    </span>
                </div>
            </div>
        </div>
    );
}

/* ─── Comparison variant (alternativa-excel) ─── */

function ComparisonVariant() {
    const { t } = useTranslations();

    return (
        <div className="grid gap-4 md:grid-cols-2">
            {/* "Before" — spreadsheet feel */}
            <div className="rounded-card border border-border bg-background px-5 py-6 shadow-md">
                <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-semibold text-muted-foreground">Excel / Sheets</span>
                    <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive-text">
                        {t("lp.preview.comparison.manualBadge")}
                    </span>
                </div>
                {/* Fake spreadsheet rows */}
                <div className="space-y-2 font-mono text-xs text-muted-foreground">
                    <div className="flex gap-2 rounded bg-paper-2 px-3 py-2">
                        <span className="w-20 text-muted-foreground border-r border-border pr-2">05/02</span>
                        <span className="flex-1">Pingo Doce</span>
                        <span className="text-muted-foreground">???</span>
                        <span className="text-destructive-text">-€47.30</span>
                    </div>
                    <div className="flex gap-2 rounded bg-paper-2 px-3 py-2">
                        <span className="w-20 text-muted-foreground border-r border-border pr-2">04/02</span>
                        <span className="flex-1 text-destructive-text">#REF!</span>
                        <span className="text-muted-foreground">-</span>
                        <span className="text-destructive-text">-€12.00</span>
                    </div>
                    <div className="flex gap-2 rounded bg-paper-2 px-3 py-2 opacity-50">
                        <span className="w-20 text-muted-foreground border-r border-border pr-2">03/02</span>
                        <span className="flex-1 text-muted-foreground italic">{t("lp.preview.comparison.missingLabel")}</span>
                        <span className="text-muted-foreground">-</span>
                        <span className="text-muted-foreground">?</span>
                    </div>
                </div>
                <div className="mt-3 flex items-center gap-1.5 text-xs text-destructive-text">
                    <ArrowDownRight className="h-3 w-3" />
                    <span>{t("lp.preview.comparison.incompleteDataLabel")}</span>
                </div>
            </div>

            {/* "After" — WonderMoney dashboard */}
            <div className="rounded-card border border-primary/30 bg-background px-5 py-6 shadow-md ring-2 ring-primary/10">
                <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-semibold text-primary">WonderMoney</span>
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                        {t("lp.preview.comparison.automaticBadge")}
                    </span>
                </div>
                <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between rounded-xl bg-primary/10 px-4 py-2.5">
                        <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-chart-3" />
                            <span className="font-medium text-foreground">Pingo Doce</span>
                        </div>
                        <div className="text-right">
                            <span className="font-mono text-sm font-semibold text-foreground">-€47.30</span>
                            <span className="ml-2 rounded bg-chart-3/10 px-1.5 py-0.5 text-xs text-chart-3">{t("lp.preview.categories.food")}</span>
                        </div>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-primary/10 px-4 py-2.5">
                        <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-primary" />
                            <span className="font-medium text-foreground">Uber</span>
                        </div>
                        <div className="text-right">
                            <span className="font-mono text-sm font-semibold text-foreground">-€12.00</span>
                            <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">{t("lp.preview.categories.transport")}</span>
                        </div>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-primary/10 px-4 py-2.5">
                        <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-chart-2" />
                            <span className="font-medium text-foreground">Netflix</span>
                        </div>
                        <div className="text-right">
                            <span className="font-mono text-sm font-semibold text-foreground">-€15.99</span>
                            <span className="ml-2 rounded bg-warning/10 px-1.5 py-0.5 text-xs text-warning-text">{t("lp.preview.categories.leisure")}</span>
                        </div>
                    </div>
                </div>
                <div className="mt-3 flex items-center gap-1.5 text-xs text-success-text">
                    <TrendingUp className="h-3 w-3" />
                    <span>{t("lp.preview.comparison.categorizedLabel")}</span>
                </div>
            </div>
        </div>
    );
}

/* ─── Main component ─── */

type Props = {
    variant: "accounts" | "budget" | "comparison";
};

export default function DashboardPreview({ variant }: Props) {
    const { t } = useTranslations();

    return (
        <section className="py-12 md:py-16">
            <div className="mx-auto max-w-3xl px-6 lg:px-8">
                <p className="mb-6 text-center text-sm font-medium text-primary">
                    {t("lp.preview.label")}
                </p>
                {variant === "accounts" && <AccountsVariant />}
                {variant === "budget" && <BudgetVariant />}
                {variant === "comparison" && <ComparisonVariant />}
            </div>
        </section>
    );
}

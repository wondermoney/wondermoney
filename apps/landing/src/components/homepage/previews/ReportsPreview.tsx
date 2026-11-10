import { useTranslations } from "@/lib/reactTranslations";
import { usePreviewFormat, type PreviewFormat } from "@/lib/usePreviewFormat";

interface ReportsPreviewProps {
	size?: "compact" | "hero";
}

const spendingCategoriesFor = (fmt: PreviewFormat) => [
	{ nameKey: "preview.categories.food", amount: fmt.money(520), pct: 80 },
	{ nameKey: "preview.categories.transport", amount: fmt.money(280), pct: 43 },
	{ nameKey: "preview.categories.utilities", amount: fmt.money(145), pct: 22 },
];

const cashflowBars = [
	{ monthKey: "preview.reports.months.aug", income: 55, expense: 70 },
	{ monthKey: "preview.reports.months.sep", income: 80, expense: 60 },
	{ monthKey: "preview.reports.months.oct", income: 70, expense: 45 },
	{ monthKey: "preview.reports.months.nov", income: 85, expense: 55 },
];

const healthMetrics = [
	{ labelKey: "preview.reports.budgetAdherence", statusKey: "preview.reports.statusGood", color: "bg-success" },
	{ labelKey: "preview.reports.savingsRate", statusKey: "preview.reports.statusFair", color: "bg-chart-2" },
	{ labelKey: "preview.reports.debtRatio", statusKey: "preview.reports.statusHigh", color: "bg-destructive" },
];

export default function ReportsPreview({ size = "compact" }: ReportsPreviewProps) {
	const { t } = useTranslations();
	const fmt = usePreviewFormat();
	const spendingCategories = spendingCategoriesFor(fmt);
	const isHero = size === "hero";

	return (
		<div
			className={
				isHero
					? "rounded-3xl border border-border bg-card p-8"
					: "rounded-2xl border border-border bg-card px-5 py-6"
			}
		>
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span
						className={
							isHero
								? "text-base font-semibold text-foreground"
								: "text-sm font-semibold text-foreground"
						}
					>
						{t("preview.reports.title")}
					</span>
				</div>
			</div>
			<div className="mt-5 grid gap-3 md:grid-cols-3">
				<div className="rounded-xl border border-border bg-muted/60 p-4">
					<div className="flex items-center justify-between text-xs">
						<span className="font-semibold text-ink-2">{t("preview.reports.spending")}</span>
					</div>
					<div className="mt-3 space-y-2">
						{spendingCategories.map((cat) => (
							<div key={cat.nameKey} className="space-y-1">
								<div className="flex items-center justify-between text-[11px]">
									<span className="text-ink-2">{t(cat.nameKey)}</span>
									<span className="font-mono text-foreground">{cat.amount}</span>
								</div>
								<div className="h-1.5 w-full rounded-full bg-paper-3">
									<div
										className="h-1.5 rounded-full bg-muted-foreground"
										style={{ width: `${cat.pct}%` }}
									/>
								</div>
							</div>
						))}
					</div>
					<div className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
						{t("preview.reports.total")} <span className="font-mono text-foreground">{fmt.money(1345)}</span>
					</div>
				</div>

				<div className="rounded-xl border border-border bg-muted/60 p-4">
					<div className="flex items-center justify-between text-xs">
						<span className="font-semibold text-ink-2">{t("preview.reports.cashflow")}</span>
					</div>
					<div className="mt-3 flex h-16 items-end gap-1">
						{cashflowBars.map((bar) => (
							<div key={bar.monthKey} className="flex flex-1 items-end gap-0.5">
								<div
									className="w-1/2 rounded-sm bg-muted-foreground"
									style={{ height: `${bar.income * 0.45}px` }}
								/>
								<div
									className="w-1/2 rounded-sm bg-paper-3"
									style={{ height: `${bar.expense * 0.45}px` }}
								/>
							</div>
						))}
					</div>
					<div className="mt-2 flex gap-1 text-[11px] text-muted-foreground">
						{cashflowBars.map((bar) => (
							<span key={bar.monthKey} className="flex-1 text-center">
								{t(bar.monthKey)}
							</span>
						))}
					</div>
					<div className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
						{t("preview.reports.avgSurplus")} <span className="font-mono text-success-text">{fmt.money(420, { sign: "always" })}{t("preview.perMonth")}</span>
					</div>
				</div>

				<div className="rounded-xl border border-border bg-muted/60 p-4">
					<div className="flex items-center justify-between text-xs">
						<span className="font-semibold text-ink-2">{t("preview.reports.health")}</span>
					</div>
					<div className="mt-3 flex items-center justify-between">
						<span className="font-mono text-2xl font-semibold text-foreground">78</span>
						<span className="text-[11px] text-muted-foreground">{t("preview.reports.outOf100")}</span>
					</div>
					<div className="mt-3 space-y-2">
						{healthMetrics.map((metric) => (
							<div
								key={metric.labelKey}
								className="flex items-center justify-between text-[11px]"
							>
								<span className="text-ink-2">{t(metric.labelKey)}</span>
								<span className="flex items-center gap-2 text-muted-foreground">
									<span className={`h-2 w-2 rounded-full ${metric.color}`} />
									{t(metric.statusKey)}
								</span>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

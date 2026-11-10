import { CookingPot, House, Navigation } from "lucide-react";
import { useTranslations } from "@/lib/reactTranslations";
import { usePreviewFormat } from "@/lib/usePreviewFormat";

type Props = { size?: "compact" | "hero" };

export default function BudgetsPreview({ size = "compact" }: Props) {
	const { t } = useTranslations();
	const fmt = usePreviewFormat();
	const isHero = size === "hero";
	const sampleBudgets = [
		// Icons follow the product app's seeded categories (CategorySeeder: HOUSING house,
		// FOOD cooking-pot, TRANSPORTATION navigation), rendered with lucide as in the app.
		{ nameKey: "preview.categories.housing", spent: 1200, budget: 1500, color: "bg-chart-1", tile: "bg-chart-1/10 text-chart-1", icon: House },
		{ nameKey: "preview.categories.food", spent: 320, budget: 400, color: "bg-chart-2", tile: "bg-chart-2/10 text-chart-2", icon: CookingPot },
		{ nameKey: "preview.categories.transport", spent: 85, budget: 150, color: "bg-chart-5", tile: "bg-chart-5/10 text-chart-5", icon: Navigation },
	];

	const totalSpent = sampleBudgets.reduce((sum, item) => sum + item.spent, 0);
	const totalBudget = sampleBudgets.reduce((sum, item) => sum + item.budget, 0);

	return (
		<div
			className={
				isHero
					? "rounded-3xl border border-border bg-card p-8"
					: "rounded-2xl border border-border bg-card px-5 py-6"
			}
		>
			<div className="flex items-center justify-between">
				<span
					className={
						isHero
							? "text-base font-semibold text-foreground"
							: "text-sm font-semibold text-foreground"
					}
				>
					{t("preview.budgets.title")}
				</span>
			</div>
			<div className="mt-5 space-y-4">
				{sampleBudgets.map((budget) => {
					const progress = Math.min((budget.spent / budget.budget) * 100, 100);
					return (
						<div key={budget.nameKey} className="space-y-2">
							<div className="flex items-center justify-between text-sm">
								<span className="flex items-center gap-2.5 font-medium text-foreground">
									<span
										className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${budget.tile}`}
										aria-hidden="true"
									>
										<budget.icon className="h-3.5 w-3.5" />
									</span>
									{t(budget.nameKey)}
								</span>
								<span className="font-mono text-xs font-medium text-muted-foreground">
									{fmt.money(budget.spent)} / {fmt.money(budget.budget)}
								</span>
							</div>
							<div className="h-1.5 w-full rounded-full bg-muted">
								<div
									className={`h-1.5 rounded-full ${budget.color}`}
									style={{ width: `${progress}%` }}
								/>
							</div>
						</div>
					);
				})}
			</div>
			<div className="mt-4 border-t border-border pt-3">
				<div className="flex items-center justify-between text-sm">
					<span className="text-muted-foreground">{t("preview.budgets.total")}</span>
					<span className="font-mono text-sm font-semibold text-foreground">
						{fmt.money(totalSpent)} <span className="text-muted-foreground">/ {fmt.money(totalBudget)}</span>
					</span>
				</div>
			</div>
		</div>
	);
}

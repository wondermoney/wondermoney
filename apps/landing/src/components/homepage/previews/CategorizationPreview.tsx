import { useTranslations } from "@/lib/reactTranslations";
import { usePreviewFormat } from "@/lib/usePreviewFormat";

type Props = { size?: "compact" | "hero" };

export default function CategorizationPreview({ size = "compact" }: Props) {
	const { t } = useTranslations();
	const fmt = usePreviewFormat();
	const isHero = size === "hero";
	const transactions = [
		{ merchant: "Pingo Doce", amount: fmt.money(-47.3, { decimals: 2 }), catKey: "preview.categories.groceries", color: "bg-chart-3/10 text-chart-3", state: "auto" as const },
		{ merchant: "Uber Portugal", amount: fmt.money(-12.4, { decimals: 2 }), catKey: "preview.categories.transport", color: "bg-primary/10 text-primary", state: "auto" as const },
		{ merchant: "Zara Portugal", amount: fmt.money(-68.9, { decimals: 2 }), catKey: "preview.categories.shopping", color: "bg-info/10 text-info-text", state: "corrected" as const, prevKey: "preview.categories.utilities" },
		{ merchant: "McDonald's Lisboa", amount: fmt.money(-9.8, { decimals: 2 }), catKey: "preview.categories.restaurants", color: "bg-destructive/10 text-destructive-text", state: "auto" as const },
		{ merchant: "Galp Energia", amount: fmt.money(-65, { decimals: 2 }), catKey: "preview.categories.transport", color: "bg-primary/10 text-primary", state: "auto" as const },
	];

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
					{t("preview.categorization.title")}
				</span>
			</div>
			<div className="mt-4 space-y-2">
				{transactions.map((tx) => (
					<div
						key={tx.merchant}
						className={`flex items-center justify-between rounded-xl border px-4 py-2.5 ${
							tx.state === "corrected"
								? "border-primary/30 bg-primary/5"
								: "border-border bg-muted/60"
						}`}
					>
						<div className="flex flex-col gap-0.5 min-w-0">
							<span className="truncate text-sm font-medium text-foreground">{tx.merchant}</span>
							<div className="flex items-center gap-1.5">
								{tx.state === "corrected" && tx.prevKey && (
									<span className="rounded-full bg-paper-3 px-2 py-0.5 text-[11px] font-medium text-ink-2 line-through">
										{t(tx.prevKey)}
									</span>
								)}
								<span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tx.color}`}>
									{t(tx.catKey)}
								</span>
								{tx.state === "corrected" && (
									<span className="text-[11px] text-primary">✓ {t("preview.categorization.corrected")}</span>
								)}
							</div>
						</div>
						<span className="ml-3 shrink-0 font-mono text-sm font-semibold text-foreground">
							{tx.amount}
						</span>
					</div>
				))}
			</div>
			<div className="mt-3 border-t border-border pt-3 text-[11px] text-muted-foreground">
				{t("preview.categorization.footer")}
			</div>
		</div>
	);
}

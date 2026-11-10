import { useTranslations } from "@/lib/reactTranslations";
import { usePreviewFormat, type PreviewFormat } from "@/lib/usePreviewFormat";

const sampleHoldingsFor = (fmt: PreviewFormat) => [
	{
		ticker: "AAPL",
		name: "Apple Inc.",
		allocation: 35,
		change: fmt.pct(2.4, { decimals: 1, sign: "always" }),
		positive: true,
		color: "bg-chart-1",
	},
	{
		ticker: "MSFT",
		name: "Microsoft",
		allocation: 28,
		change: fmt.pct(1.8, { decimals: 1, sign: "always" }),
		positive: true,
		color: "bg-chart-5",
	},
	{
		ticker: "VWCE",
		name: "Vanguard FTSE",
		allocation: 22,
		change: fmt.pct(-0.3, { decimals: 1 }),
		positive: false,
		color: "bg-chart-3",
	},
];

type Props = { size?: "compact" | "hero" };

export default function PortfolioPreview({ size = "compact" }: Props) {
	const { t } = useTranslations();
	const fmt = usePreviewFormat();
	const sampleHoldings = sampleHoldingsFor(fmt);
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
				<span
					className={
						isHero
							? "text-base font-semibold text-foreground"
							: "text-sm font-semibold text-foreground"
					}
				>
					{t("preview.portfolio.title")}
				</span>
			</div>
			<div className="mt-5">
				<div>
					<p className="text-xs text-muted-foreground">
						{t("preview.portfolio.totalValue")}
					</p>
					<div className="mt-2 flex items-baseline gap-3">
						<span className="font-mono text-2xl font-semibold text-foreground">
							{fmt.money(24680.5, { decimals: 2 })}
						</span>
						<span className="font-mono text-xs font-semibold text-success-text">
							{fmt.pct(12.4, { decimals: 1, sign: "always" })}
						</span>
					</div>
				</div>
				<div className="mt-4 grid grid-cols-3 gap-2">
					<div className="rounded-lg bg-muted px-3 py-2">
						<p className="text-[11px] text-muted-foreground">{t("preview.portfolio.totalReturn")}</p>
						<p className="mt-1 font-mono text-sm font-semibold text-foreground">
							{fmt.money(2720.3, { decimals: 2 })}
						</p>
					</div>
					<div className="rounded-lg bg-muted px-3 py-2">
						<p className="text-[11px] text-muted-foreground">{t("preview.portfolio.gainLoss")}</p>
						<p className="mt-1 font-mono text-sm font-semibold text-success-text">
							{fmt.money(1840, { decimals: 2, sign: "always" })}
						</p>
					</div>
					<div className="rounded-lg bg-muted px-3 py-2">
						<p className="text-[11px] text-muted-foreground">{t("preview.portfolio.yield")}</p>
						<p className="mt-1 font-mono text-sm font-semibold text-foreground">
							{fmt.pct(3.2, { decimals: 1 })}
						</p>
					</div>
				</div>
				<div className="mt-5">
					<div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
						<span>{t("preview.portfolio.holdings")}</span>
						<span>{t("preview.portfolio.allocation")}</span>
					</div>
					<div className="space-y-2">
						{sampleHoldings.map((holding) => (
							<div
								key={holding.ticker}
								className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
							>
								<div className="flex items-center gap-2">
									<div
										className={`flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-semibold text-primary-foreground ${holding.color}`}
									>
										{holding.ticker.slice(0, 2)}
									</div>
									<div>
										<p className="text-xs font-semibold text-foreground">
											{holding.ticker}
										</p>
										<p className="text-[11px] text-muted-foreground">
											{holding.name}
										</p>
									</div>
								</div>
								<div className="text-right">
									<p className="font-mono text-xs font-semibold text-foreground">
										{fmt.pct(holding.allocation, { decimals: 0 })}
									</p>
									<p
										className={`font-mono text-[11px] font-semibold ${
											holding.positive ? "text-success-text" : "text-destructive-text"
										}`}
									>
										{holding.change}
									</p>
								</div>
							</div>
						))}
					</div>
					<div className="mt-4">
						<div className="mb-2 flex h-2 overflow-hidden rounded-full bg-muted">
							{sampleHoldings.map((holding) => (
								<div
									key={holding.ticker}
									className={holding.color}
									style={{ width: `${holding.allocation}%` }}
								/>
							))}
						</div>
						<div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
							{sampleHoldings.map((holding) => (
								<div key={holding.ticker} className="flex items-center gap-2">
									<span className={`h-2 w-2 rounded-full ${holding.color}`} />
									<span>{holding.ticker}</span>
									<span className="font-mono text-[11px] text-muted-foreground">
										{fmt.pct(holding.allocation, { decimals: 0 })}
									</span>
								</div>
							))}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

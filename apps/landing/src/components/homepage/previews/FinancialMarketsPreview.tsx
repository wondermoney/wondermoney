import { useTranslations } from "@/lib/reactTranslations";
import { usePreviewFormat, type PreviewFormat } from "@/lib/usePreviewFormat";

import { Badge } from "../../ui/badge";

// The screener was removed from the product. These rows are
// ticker / price / change / market cap, which is what the watchlist shows, so the
// panel is relabelled rather than dropped: the visual is accurate for a feature
// that still exists.
const watchlistRowsFor = (fmt: PreviewFormat) => [
	{
		ticker: "AAPL",
		price: fmt.money(189.3, { currency: "USD", decimals: 2 }),
		change: fmt.pct(0.66, { decimals: 2, sign: "always" }),
		positive: true,
		marketCap: fmt.money(2940000000000, { currency: "USD", compact: true, decimals: 2 }),
	},
	{
		ticker: "MSFT",
		price: fmt.money(415.2, { currency: "USD", decimals: 2 }),
		change: fmt.pct(1.12, { decimals: 2, sign: "always" }),
		positive: true,
		marketCap: fmt.money(3080000000000, { currency: "USD", compact: true, decimals: 2 }),
	},
	{
		ticker: "NVDA",
		price: fmt.money(875.4, { currency: "USD", decimals: 2 }),
		change: fmt.pct(-0.83, { decimals: 2 }),
		positive: false,
		marketCap: fmt.money(2160000000000, { currency: "USD", compact: true, decimals: 2 }),
	},
];

type Props = { size?: "compact" | "hero" };

export default function FinancialMarketsPreview({ size = "compact" }: Props) {
	const { t } = useTranslations();
	const fmt = usePreviewFormat();
	const watchlistRows = watchlistRowsFor(fmt);
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
						{t("preview.financialMarkets.title")}
					</span>
					<Badge variant="secondary">{t("preview.financialMarkets.soon")}</Badge>
				</div>
			</div>
			<div className="mt-5 grid gap-3 sm:grid-cols-2">
				<div className="rounded-xl border border-border bg-muted/60 p-4">
					<div className="flex items-center justify-between text-xs">
						<span className="font-semibold text-ink-2">{t("preview.financialMarkets.explorer")}</span>
					</div>
					<div className="mt-3">
						<div className="flex items-baseline gap-2">
							<span className="text-xs font-semibold text-foreground">
								AAPL
							</span>
							<span className="text-[11px] text-muted-foreground">Apple Inc.</span>
						</div>
						<div className="mt-2 flex items-baseline gap-2">
							<span className="font-mono text-lg font-semibold text-foreground">
								{fmt.money(189.3, { currency: "USD", decimals: 2 })}
							</span>
							<span className="text-xs font-medium text-success-text">
								{fmt.pct(0.66, { decimals: 2, sign: "always" })}
							</span>
						</div>
						<div className="mt-3 space-y-1">
							<div className="flex justify-between text-[11px] text-muted-foreground">
								<span>{t("preview.financialMarkets.52wLow")} {fmt.money(124.17, { currency: "USD", decimals: 2 })}</span>
								<span>{t("preview.financialMarkets.52wHigh")} {fmt.money(199.62, { currency: "USD", decimals: 2 })}</span>
							</div>
							<div className="relative h-1.5 w-full rounded-full bg-paper-3">
								<div
									className="h-1.5 rounded-full bg-muted-foreground"
									style={{ width: "86%" }}
								/>
								<div
									className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-background bg-foreground"
									style={{ left: "86%" }}
								/>
							</div>
						</div>
						<div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-2">
							<div>
								<p className="text-[11px] text-muted-foreground">{t("preview.financialMarkets.marketCap")}</p>
								<p className="font-mono text-xs font-medium text-foreground">
									{fmt.money(2940000000000, { currency: "USD", compact: true, decimals: 2 })}
								</p>
							</div>
							<div>
								<p className="text-[11px] text-muted-foreground">{t("preview.financialMarkets.pe")}</p>
								<p className="font-mono text-xs font-medium text-foreground">
									31.2
								</p>
							</div>
						</div>
					</div>
				</div>

				<div className="rounded-xl border border-border bg-muted/60 p-4">
					<div className="flex items-center justify-between text-xs">
						<span className="font-semibold text-ink-2">{t("preview.financialMarkets.watchlist")}</span>
					</div>
					<div className="mt-3">
						<div className="grid grid-cols-4 gap-1 pb-1.5 text-[11px] text-muted-foreground">
							<span>{t("preview.financialMarkets.ticker")}</span>
							<span className="text-right font-mono">{t("preview.financialMarkets.price")}</span>
							<span className="text-right">{t("preview.financialMarkets.chg")}</span>
							<span className="text-right font-mono">{t("preview.financialMarkets.mktCap")}</span>
						</div>
						{watchlistRows.map((row) => (
							<div
								key={row.ticker}
								className="grid grid-cols-4 gap-1 border-t border-border py-1.5 text-xs"
							>
								<span className="font-mono font-medium text-foreground">
									{row.ticker}
								</span>
								<span className="text-right font-mono text-foreground">
									{row.price}
								</span>
								<span
									className={`text-right ${
										row.positive ? "text-success-text" : "text-destructive-text"
									}`}
								>
									{row.change}
								</span>
								<span className="text-right font-mono text-muted-foreground">
									{row.marketCap}
								</span>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

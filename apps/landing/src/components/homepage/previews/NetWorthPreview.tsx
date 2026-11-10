import { useTranslations } from "@/lib/reactTranslations";
import { usePreviewFormat, type PreviewFormat } from "@/lib/usePreviewFormat";

// Mock data mirrors the real shape from
// `web/lib/api/net-worth/useNetWorth.ts` — the page is a marketing
// mockup, not the real product. The numbers and labels are sample
// data designed to look like a real WonderMoney net worth summary.
const SAMPLE_NET_WORTH = (fmt: PreviewFormat) => fmt.money(164500);
const SAMPLE_ASSETS_TOTAL = (fmt: PreviewFormat) => fmt.money(248000);
const SAMPLE_LIABILITIES_TOTAL = (fmt: PreviewFormat) => fmt.money(83500);

interface SampleRow {
	labelKey: string;
	amount: string;
	kind: "asset" | "liability";
}

const sampleAssetRowsFor = (fmt: PreviewFormat): SampleRow[] => [
	{ labelKey: "preview.netWorth.bankAccounts", amount: fmt.money(45200), kind: "asset" },
	{ labelKey: "preview.netWorth.investments", amount: fmt.money(202800), kind: "asset" },
];

const sampleLiabilityRowsFor = (fmt: PreviewFormat): SampleRow[] => [
	{ labelKey: "preview.netWorth.mortgage", amount: fmt.money(71200), kind: "liability" },
	{ labelKey: "preview.netWorth.carLoan", amount: fmt.money(8200), kind: "liability" },
	{ labelKey: "preview.netWorth.creditCard", amount: fmt.money(4100), kind: "liability" },
];

// Six monthly history points (May → Oct), simulated upward trend.
// Y values are net worth amounts in EUR (in thousands for the chart math).
const historyPoints = [
	{ x: "2026-05", y: 148.2 },
	{ x: "2026-06", y: 151.8 },
	{ x: "2026-07", y: 156.4 },
	{ x: "2026-08", y: 159.1 },
	{ x: "2026-09", y: 161.7 },
	{ x: "2026-10", y: 164.5 },
];

type Props = { size?: "compact" | "hero" };

export default function NetWorthPreview({ size = "compact" }: Props) {
	const { t } = useTranslations();
	const fmt = usePreviewFormat();
	const sampleAssetRows = sampleAssetRowsFor(fmt);
	const sampleLiabilityRows = sampleLiabilityRowsFor(fmt);
	const isHero = size === "hero";

	// SVG chart math (used in the mini history panel).
	const chartWidth = 220;
	const chartHeight = 64;
	const yMin = 145;
	const yMax = 168;
	const yScale = (y: number) =>
		chartHeight - ((y - yMin) / (yMax - yMin)) * chartHeight;
	const xScale = (i: number) =>
		(i / (historyPoints.length - 1)) * chartWidth;

	const linePath = historyPoints
		.map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(i)} ${yScale(p.y)}`)
		.join(" ");
	const areaPath = `${linePath} L ${xScale(historyPoints.length - 1)} ${chartHeight} L 0 ${chartHeight} Z`;

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
					{t("preview.netWorth.title")}
				</span>
				<span
					className={
						isHero
							? "rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
							: "rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
					}
				>
					{t("preview.netWorth.historyPeriod")}
				</span>
			</div>

			<div
				className={
					isHero
						? "mt-6 grid gap-6 md:grid-cols-2"
						: "mt-4 grid gap-4 md:grid-cols-2"
				}
			>
				{/* Left: net worth + assets/liabilities breakdown */}
				<div>
					<p
						className={
							isHero
								? "text-xs text-muted-foreground"
								: "text-[11px] text-muted-foreground"
						}
					>
						{t("preview.netWorth.netWorth")}
					</p>
					<p
						className={
							isHero
								? "mt-1 font-mono text-3xl font-semibold tracking-tight text-foreground md:text-4xl"
								: "mt-1 font-mono text-2xl font-semibold tracking-tight text-foreground"
						}
					>
						{SAMPLE_NET_WORTH(fmt)}
					</p>

					<div
						className={
							isHero
								? "mt-5 space-y-3"
								: "mt-4 space-y-2"
						}
					>
						<div className="flex items-center justify-between text-sm">
							<span className="text-ink-2">
								{t("preview.netWorth.assets")}
							</span>
							<span className="font-mono text-sm font-semibold text-foreground">
								{SAMPLE_ASSETS_TOTAL(fmt)}
							</span>
						</div>
						<ul className={isHero ? "ml-3 space-y-1" : "ml-3 space-y-0.5"}>
							{sampleAssetRows.map((row) => (
								<li
									key={row.labelKey}
									className={
										isHero
											? "flex items-center justify-between text-xs"
											: "flex items-center justify-between text-[11px]"
									}
								>
									<span className="text-muted-foreground">{t(row.labelKey)}</span>
									<span className="font-mono text-ink-2">
										{row.amount}
									</span>
								</li>
							))}
						</ul>
						<div className="flex items-center justify-between text-sm">
							<span className="text-ink-2">
								{t("preview.netWorth.liabilities")}
							</span>
							<span className="font-mono text-sm font-semibold text-foreground">
								−{SAMPLE_LIABILITIES_TOTAL(fmt)}
							</span>
						</div>
						<ul className={isHero ? "ml-3 space-y-1" : "ml-3 space-y-0.5"}>
							{sampleLiabilityRows.map((row) => (
								<li
									key={row.labelKey}
									className={
										isHero
											? "flex items-center justify-between text-xs"
											: "flex items-center justify-between text-[11px]"
									}
								>
									<span className="text-muted-foreground">{t(row.labelKey)}</span>
									<span className="font-mono text-ink-2">
										{row.amount}
									</span>
								</li>
							))}
						</ul>
					</div>
				</div>

				{/* Right: history chart */}
				<div>
					<p
						className={
							isHero
								? "mb-2 text-xs text-muted-foreground"
								: "mb-1.5 text-[11px] text-muted-foreground"
						}
					>
						{t("preview.netWorth.history")}
					</p>
					<div
						className={
							isHero
								? "rounded-xl border border-border bg-muted/40 p-4"
								: "rounded-lg border border-border bg-muted/40 p-3"
						}
					>
						<svg
							viewBox={`0 0 ${chartWidth} ${chartHeight + 16}`}
							className="h-16 w-full"
							role="img"
							aria-label={`${t("preview.netWorth.history")}, ${t("preview.netWorth.historyPeriod")}`}
						>
							<defs>
								<linearGradient id="networth-area" x1="0" x2="0" y1="0" y2="1">
									<stop offset="0%" stopColor="oklch(var(--chart-1))" stopOpacity="0.18" />
									<stop offset="100%" stopColor="oklch(var(--chart-1))" stopOpacity="0" />
								</linearGradient>
							</defs>
							<path d={areaPath} fill="url(#networth-area)" />
							<path
								d={linePath}
								fill="none"
								stroke="oklch(var(--chart-1))"
								strokeWidth="1.5"
							/>
							{historyPoints.map((p, i) => (
								<circle
									key={p.x}
									cx={xScale(i)}
									cy={yScale(p.y)}
									r="2"
									fill="oklch(var(--chart-1))"
								/>
							))}
						</svg>
						<div
							className={
								isHero
									? "mt-2 flex justify-between text-[11px] text-muted-foreground"
									: "mt-1.5 flex justify-between text-[11px] text-muted-foreground"
							}
						>
							{historyPoints.map((p, i) => (
								<span key={p.x} className="font-mono">
									{isHero || i === 0 || i === historyPoints.length - 1
										? fmt.month(new Date(`${p.x}-01T00:00:00Z`))
										: ""}
								</span>
							))}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

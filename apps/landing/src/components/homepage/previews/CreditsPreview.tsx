import { useTranslations } from "@/lib/reactTranslations";
import { usePreviewFormat, type PreviewFormat } from "@/lib/usePreviewFormat";

type CreditStatus = "ACTIVE" | "PAID_OFF" | "CLOSED";

interface SampleLoan {
	nameKey: string;
	typeKey: string;
	principal: string;
	monthlyPayment: string;
	rate: string;
	status: CreditStatus;
}

const sampleLoansFor = (fmt: PreviewFormat, perMonth: string): SampleLoan[] => [
	{
		nameKey: "preview.credits.loan1",
		typeKey: "preview.credits.type.mortgage",
		principal: fmt.money(142500, { decimals: 2 }),
		monthlyPayment: `${fmt.money(820)}${perMonth}`,
		rate: fmt.pct(3.2, { decimals: 1 }),
		status: "ACTIVE",
	},
	{
		nameKey: "preview.credits.loan2",
		typeKey: "preview.credits.type.auto",
		principal: fmt.money(8200, { decimals: 2 }),
		monthlyPayment: `${fmt.money(285)}${perMonth}`,
		rate: fmt.pct(5.9, { decimals: 1 }),
		status: "ACTIVE",
	},
	{
		nameKey: "preview.credits.loan3",
		typeKey: "preview.credits.type.student",
		principal: fmt.money(12300, { decimals: 2 }),
		monthlyPayment: `${fmt.money(142)}${perMonth}`,
		rate: fmt.pct(4.5, { decimals: 1 }),
		status: "ACTIVE",
	},
	{
		nameKey: "preview.credits.loan4",
		typeKey: "preview.credits.type.personal",
		principal: fmt.money(1847, { decimals: 2 }),
		monthlyPayment: `${fmt.money(0)}${perMonth}`,
		rate: fmt.pct(8.9, { decimals: 1 }),
		status: "ACTIVE",
	},
];

// Aligned with the real `CreditOverview` aggregate in
// `web/lib/api/credit/types.ts` — `totalOutstandingDebt`,
// `monthlyRepaymentTotal`, `netWorthImpact`, `repaymentsNeedingReviewCount`.
const summaryItemsFor = (fmt: PreviewFormat): ReadonlyArray<{ labelKey: string; value: string }> => [
	{ labelKey: "preview.credits.totalDebt", value: fmt.money(164847) },
	{ labelKey: "preview.credits.monthlyPayment", value: fmt.money(1247) },
	{ labelKey: "preview.credits.netWorth", value: fmt.money(-164847) },
	{ labelKey: "preview.credits.count", value: "4" },
];

type Props = { size?: "compact" | "hero" };

export default function CreditsPreview({ size = "compact" }: Props) {
	const { t } = useTranslations();
	const fmt = usePreviewFormat();
	const sampleLoans = sampleLoansFor(fmt, t("preview.perMonth"));
	const summaryItems = summaryItemsFor(fmt);
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
					{t("preview.credits.title")}
				</span>
			</div>

			<div
				className={
					isHero
						? "mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
						: "mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"
				}
			>
				{summaryItems.map((item) => (
					<div
						key={item.labelKey}
						className={
							isHero
								? "rounded-xl border border-border bg-muted/60 p-4"
								: "rounded-lg bg-muted/60 px-3 py-2"
						}
					>
						<p
							className={
								isHero ? "text-xs text-muted-foreground" : "text-[11px] text-muted-foreground"
							}
						>
							{t(item.labelKey)}
						</p>
						<p
							className={
								isHero
									? "mt-1 font-mono text-base font-semibold text-foreground"
									: "mt-0.5 font-mono text-sm font-semibold text-foreground"
							}
						>
							{item.value}
						</p>
					</div>
				))}
			</div>

			<div className={isHero ? "mt-6" : "mt-4"}>
				<div className="grid grid-cols-12 gap-2 border-b border-border pb-2 text-[11px] text-muted-foreground">
					<span className="col-span-7">{t("preview.credits.loan")}</span>
					<span className="col-span-5 text-right">{t("preview.credits.principal")}</span>
				</div>
				<div className="divide-y divide-border">
					{sampleLoans.map((loan) => (
						<div
							key={loan.nameKey}
							className={
								isHero
									? "grid grid-cols-12 gap-2 py-3 text-sm"
									: "grid grid-cols-12 gap-2 py-2 text-xs"
							}
						>
							<div className="col-span-7 min-w-0">
								<p className="truncate font-medium text-foreground">
									{t(loan.nameKey)}
								</p>
								<p className="mt-0.5 text-[11px] text-muted-foreground">
									{t(loan.typeKey)}
								</p>
							</div>
							<div className="col-span-5 text-right">
								<p
									className={
										isHero
											? "font-mono text-sm font-semibold text-foreground"
											: "font-mono text-xs font-semibold text-foreground"
									}
								>
									{loan.principal}
								</p>
								<p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
									{loan.monthlyPayment} · {loan.rate} {t("preview.credits.apr")}
								</p>
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

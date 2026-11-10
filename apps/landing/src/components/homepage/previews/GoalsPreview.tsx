import { useTranslations } from "@/lib/reactTranslations";
import { usePreviewFormat, type PreviewFormat } from "@/lib/usePreviewFormat";

type GoalType = "save_up" | "debt_paydown";

// Raw entity status (from `Goal` entity, `api/src/database/entity/Goal.ts`)
type GoalStatus = "active" | "archived" | "completed" | "paused";

// Computed summary status (from `GoalSummary`, `api/src/services/goal/goal-summary.service.ts`)
type GoalSummaryStatus = "behind" | "funded" | "on_track" | "paused";

interface SampleGoal {
	nameKey: string;
	rawStatus: GoalStatus;
	summaryStatus?: GoalSummaryStatus;
	type: GoalType;
	available: string;
	target: string;
	progress: number;
	payoffDate?: string;
}

const STATUS_KEY_MAP: Record<GoalStatus | GoalSummaryStatus, string> = {
	active: "preview.goals.statusActive",
	archived: "preview.goals.statusArchived",
	completed: "preview.goals.statusCompleted",
	paused: "preview.goals.statusPaused",
	behind: "preview.goals.statusBehind",
	funded: "preview.goals.statusFunded",
	on_track: "preview.goals.statusOnTrack",
};

// Sample data mirrors the real staging exploration (5 goals, 1 paused,
// 1 funded, 1 debt-paydown). `summaryStatus` reflects the computed status
// from `GoalSummary.status` (when the goal is behind/on_track/funded/paused).
const sampleGoalsFor = (fmt: PreviewFormat): SampleGoal[] => [
	{
		nameKey: "preview.goals.goal1",
		rawStatus: "active",
		summaryStatus: "on_track",
		type: "save_up",
		available: fmt.money(1240),
		target: fmt.money(5000),
		progress: 25,
	},
	{
		nameKey: "preview.goals.goal2",
		rawStatus: "active",
		summaryStatus: "on_track",
		type: "save_up",
		available: fmt.money(18500),
		target: fmt.money(50000),
		progress: 37,
	},
	{
		nameKey: "preview.goals.goal3",
		rawStatus: "active",
		summaryStatus: "behind",
		type: "debt_paydown",
		available: fmt.money(3400),
		target: fmt.money(10000),
		progress: 34,
		payoffDate: "2029-03",
	},
	{
		nameKey: "preview.goals.goal4",
		rawStatus: "paused",
		type: "save_up",
		available: fmt.money(0),
		target: fmt.money(15000),
		progress: 0,
	},
	{
		nameKey: "preview.goals.goal5",
		rawStatus: "completed",
		summaryStatus: "funded",
		type: "save_up",
		available: fmt.money(10000),
		target: fmt.money(10000),
		progress: 100,
	},
];

// Matches `GoalSummaryCards` (3-up): Target total · Active count · Funded total.
// `targetTotal` = sum of targetAmount, `active` = count of (active + paused),
// `funded` = sum of `summary.fundedHistorically` (matches the real `GoalSummaryCards`).
const summaryItemsFor = (fmt: PreviewFormat): ReadonlyArray<{ labelKey: string; value: string }> => [
	{ labelKey: "preview.goals.targetTotal", value: fmt.money(90000) },
	{ labelKey: "preview.goals.active", value: "3" },
	{ labelKey: "preview.goals.funded", value: fmt.money(10000) },
];

// Display status precedence: summary status (computed) wins when present
// for active/paused goals; raw status is shown for archived/completed.
function displayStatus(goal: SampleGoal): GoalStatus | GoalSummaryStatus {
	if (goal.rawStatus === "archived" || goal.rawStatus === "completed") {
		return goal.rawStatus;
	}
	return goal.summaryStatus ?? goal.rawStatus;
}

type Props = {
	size?: "compact" | "hero";
	/** Show only the first few sample goals (the homepage shows two, one row). */
	limit?: number;
};

export default function GoalsPreview({ size = "compact", limit }: Props) {
	const { t } = useTranslations();
	const fmt = usePreviewFormat();
	const sampleGoals = sampleGoalsFor(fmt).slice(0, limit);
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
					{t("preview.goals.title")}
				</span>
			</div>

			<div
				className={
					isHero
						? "mt-6 grid grid-cols-3 gap-3"
						: "mt-4 grid grid-cols-3 gap-2"
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
								isHero
									? "text-xs text-muted-foreground"
									: "text-[11px] text-muted-foreground"
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

			<div className={isHero ? "mt-6 grid gap-4 sm:grid-cols-2" : "mt-5 grid gap-4 sm:grid-cols-2"}>
				{sampleGoals.map((goal) => {
					const status = displayStatus(goal);
					const isDebt = goal.type === "debt_paydown";
					return (
						<div
							key={goal.nameKey}
							className={
								isHero
									? "rounded-2xl bg-muted p-5"
									: "rounded-xl bg-muted/60 p-4"
							}
						>
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0 space-y-1.5">
									<span
										className={
											isHero
												? "block text-base font-semibold text-foreground"
												: "block text-sm font-semibold text-foreground"
										}
									>
										{t(goal.nameKey)}
									</span>
									<div className="flex flex-wrap items-center gap-1.5">
										{isDebt && (
											<span
												className={
													isHero
														? "rounded-full border border-input px-2.5 py-0.5 text-[11px] font-medium text-ink-2"
														: "rounded-full border border-input px-2 py-0.5 text-[11px] font-medium text-ink-2"
												}
											>
												{t("preview.goals.typeDebtPaydown")}
											</span>
										)}
										<span
											className={
												isHero
													? "rounded-full border border-input px-2.5 py-0.5 text-[11px] font-medium text-ink-2"
													: "rounded-full border border-input px-2 py-0.5 text-[11px] font-medium text-ink-2"
											}
										>
											{t(STATUS_KEY_MAP[status])}
										</span>
									</div>
								</div>
								<div className="shrink-0 text-right">
									<p
										className={
											isHero
												? "font-mono text-2xl font-semibold text-foreground"
												: "font-mono text-lg font-semibold text-foreground"
										}
									>
										{goal.available}
									</p>
									<p
										className={
											isHero
												? "text-xs text-muted-foreground"
												: "text-[11px] text-muted-foreground"
										}
									>
										{t(isDebt ? "preview.goals.remaining" : "preview.goals.available")}
									</p>
								</div>
							</div>

							<div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
								<div
									className="h-2 rounded-full bg-foreground"
									style={{ width: `${goal.progress}%` }}
								/>
							</div>

							<div
								className={
									isHero
										? "mt-2 flex items-center justify-between text-xs"
										: "mt-2 flex items-center justify-between text-[11px]"
								}
							>
								{isDebt && goal.payoffDate ? (
									<span className="text-muted-foreground">
										{t("preview.goals.payoffBy")} {fmt.monthYear(new Date(`${goal.payoffDate}-01T00:00:00Z`))}
									</span>
								) : (
									<span className="font-mono text-muted-foreground">
										{goal.available} <span className="text-muted-foreground">/</span> {goal.target}
									</span>
								)}
								<span
									className={
										isHero
											? "font-mono text-sm font-semibold text-foreground"
											: "font-mono text-xs font-semibold text-ink-2"
									}
								>
									{fmt.pct(goal.progress, { decimals: 0 })}
								</span>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

import { Lock } from "lucide-react";
import { useTranslations } from "@/lib/reactTranslations";

type Props = { size?: "compact" | "hero" };

export default function SecurityDashboardPreview({ size = "compact" }: Props) {
	const { t } = useTranslations();
	const isHero = size === "hero";
	const statusRows = [
		{ label: t("preview.security.row1Label"), value: t("preview.security.row1Value") },
		{ label: t("preview.security.row2Label"), value: t("preview.security.row2Value") },
		{ label: t("preview.security.row3Label"), value: t("preview.security.row3Value") },
		{ label: t("preview.security.row4Label"), value: t("preview.security.row4Value") },
		{ label: t("preview.security.row5Label"), value: t("preview.security.row5Value") },
		{ label: t("preview.security.row6Label"), value: t("preview.security.row6Value") },
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
					{t("preview.security.title")}
				</span>
			</div>
			{/* Overall status */}
			<div className="mt-4 flex items-center gap-3 rounded-xl bg-success/5 px-4 py-3 border border-success/30">
				<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/10">
					<Lock className="h-5 w-5 text-success-text" aria-hidden="true" />
				</div>
				<div>
					<p className="text-sm font-semibold text-success-text">{t("preview.security.allChecksPassed")}</p>
					<p className="text-xs text-success-text">{t("preview.security.dataProtected")}</p>
				</div>
			</div>
			{/* Status rows */}
			<div className="mt-4 space-y-2">
				{statusRows.map((row) => (
					<div
						key={row.label}
						className="flex items-center justify-between rounded-lg border border-border bg-muted/60 px-3 py-2"
					>
						<div className="flex items-center gap-2">
							<span className="h-2 w-2 shrink-0 rounded-full bg-success" />
							<span className="text-xs text-ink-2">{row.label}</span>
						</div>
						<span className="text-xs font-semibold text-success-text">{row.value}</span>
					</div>
				))}
			</div>
		</div>
	);
}

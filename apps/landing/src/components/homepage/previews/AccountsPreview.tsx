import { useTranslations } from "@/lib/reactTranslations";
import { usePreviewFormat } from "@/lib/usePreviewFormat";

type Props = { size?: "compact" | "hero" };

export default function AccountsPreview({ size = "compact" }: Props) {
	const { t } = useTranslations();
	const fmt = usePreviewFormat();
	const isHero = size === "hero";
	const sampleAccounts = [
		{ nameKey: "preview.accounts.account1", balance: fmt.money(2450, { decimals: 2 }), tone: "text-success-text" },
		{ nameKey: "preview.accounts.account2", balance: fmt.money(8750, { decimals: 2 }), tone: "text-success-text" },
		{ nameKey: "preview.accounts.account3", balance: fmt.money(-320, { decimals: 2 }), tone: "text-destructive-text" },
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
					{t("preview.accounts.title")}
				</span>
			</div>
			<div className="mt-5 space-y-3">
				{sampleAccounts.map((account) => (
					<div
						key={account.nameKey}
						className="flex items-center justify-between rounded-xl border border-border bg-muted/60 px-4 py-3"
					>
						<span className="text-sm font-medium text-foreground">
							{t(account.nameKey)}
						</span>
						<span className={`font-mono text-sm font-semibold ${account.tone}`}>
							{account.balance}
						</span>
					</div>
				))}
			</div>
			<div className="mt-4 border-t border-border pt-3">
				<div className="flex items-center justify-between text-sm">
					<span className="text-muted-foreground">{t("preview.accounts.totalBalance")}</span>
					<span className="font-mono text-sm font-semibold text-foreground">
						{fmt.money(10880, { decimals: 2 })}
					</span>
				</div>
			</div>
		</div>
	);
}

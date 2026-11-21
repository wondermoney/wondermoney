import { Check } from "lucide-react";
import { useTranslations } from "@/lib/reactTranslations";
import { usePreviewFormat } from "@/lib/usePreviewFormat";
import { cn } from "@/lib/utils";

/*
 * The hero mockups of the feature pages added in #600, in the same frame as the other
 * previews: a card, a title, rows on the muted surface. Sample data only.
 */

function PreviewFrame({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="rounded-2xl border border-border bg-card px-5 py-6">
			<span className="text-sm font-semibold text-foreground">{title}</span>
			{children}
		</div>
	);
}

function Row({ children, className }: { children: React.ReactNode; className?: string }) {
	return (
		<div className={cn("flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/60 px-4 py-2.5", className)}>
			{children}
		</div>
	);
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "success" | "warning" | "info" }) {
	const tones = {
		neutral: "bg-paper-3 text-ink-2",
		success: "bg-success/10 text-success-text",
		warning: "bg-warning/10 text-warning-text",
		info: "bg-info/10 text-info-text",
	};
	return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", tones[tone])}>{children}</span>;
}

export function HouseholdPreview() {
	const { t } = useTranslations();
	const members = [
		{ name: "Ana", roleKey: "preview.household.roleOwner" },
		{ name: "Rui", roleKey: "preview.household.roleMember" },
		{ name: "Marta", roleKey: "preview.household.roleViewer" },
	];
	const accounts = [
		{ nameKey: "preview.household.jointAccount", accessKey: "preview.household.shared", tone: "success" as const },
		{ nameKey: "preview.household.privateAccount", accessKey: "preview.household.private", tone: "neutral" as const },
	];

	return (
		<PreviewFrame title={t("preview.household.title")}>
			<div className="mt-4 space-y-2">
				{members.map((member) => (
					<Row key={member.name}>
						<div className="flex min-w-0 items-center gap-3">
							<span
								className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-paper-3 text-xs font-semibold text-ink-2"
								aria-hidden="true"
							>
								{member.name.charAt(0)}
							</span>
							<span className="truncate text-sm text-foreground">{member.name}</span>
						</div>
						<span className="text-xs text-muted-foreground">{t(member.roleKey)}</span>
					</Row>
				))}
			</div>
			<div className="mt-4 border-t border-border pt-4 space-y-2">
				{accounts.map((account) => (
					<Row key={account.nameKey}>
						<span className="truncate text-sm text-ink-2">{t(account.nameKey)}</span>
						<Badge tone={account.tone}>{t(account.accessKey)}</Badge>
					</Row>
				))}
			</div>
		</PreviewFrame>
	);
}

export function ImportsPreview() {
	const { t } = useTranslations();
	const fmt = usePreviewFormat();
	const groups = [
		{ labelKey: "preview.imports.statusNew", count: 45, tone: "success" as const },
		{ labelKey: "preview.imports.statusExisting", count: 2, tone: "neutral" as const },
		{ labelKey: "preview.imports.statusDuplicate", count: 1, tone: "warning" as const },
	];

	return (
		<PreviewFrame title={t("preview.imports.title")}>
			<div className="mt-4 flex items-center justify-between gap-3 text-sm">
				<span className="truncate text-ink-2">{t("preview.imports.fileName")}</span>
				<span className="shrink-0 text-muted-foreground">{t("preview.imports.rows", { count: fmt.num(48, 0) })}</span>
			</div>
			<div className="mt-4 space-y-2">
				{groups.map((group) => (
					<Row key={group.labelKey}>
						<Badge tone={group.tone}>{t(group.labelKey)}</Badge>
						<span className="font-mono text-sm font-semibold text-foreground">{fmt.num(group.count, 0)}</span>
					</Row>
				))}
			</div>
			<div className="mt-3 border-t border-border pt-3 text-[11px] text-muted-foreground">{t("preview.imports.note")}</div>
		</PreviewFrame>
	);
}

export function RecurringPreview() {
	const { t } = useTranslations();
	const fmt = usePreviewFormat();
	const bills = [
		{ nameKey: "preview.recurring.rent", day: 1, amount: 850, statusKey: "preview.recurring.paid", tone: "success" as const },
		{ nameKey: "preview.recurring.electricity", day: 8, amount: 64.2, statusKey: "preview.recurring.paid", tone: "success" as const },
		{ nameKey: "preview.recurring.internet", day: 15, amount: 39.99, statusKey: "preview.recurring.due", tone: "warning" as const },
		{ nameKey: "preview.recurring.gym", day: 22, amount: 35, statusKey: "preview.recurring.projected", tone: "info" as const },
	];

	return (
		<PreviewFrame title={t("preview.recurring.title")}>
			<div className="mt-4 space-y-2">
				{bills.map((bill) => (
					<Row key={bill.nameKey}>
						<div className="flex min-w-0 items-center gap-3">
							<span className="w-12 shrink-0 text-xs text-muted-foreground">{t("preview.recurring.day", { day: bill.day })}</span>
							<span className="truncate text-sm text-ink-2">{t(bill.nameKey)}</span>
						</div>
						<div className="flex shrink-0 items-center gap-3">
							<Badge tone={bill.tone}>{t(bill.statusKey)}</Badge>
							<span className="font-mono text-sm font-semibold text-foreground">{fmt.money(-bill.amount, { decimals: 2 })}</span>
						</div>
					</Row>
				))}
			</div>
			<div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
				<span className="text-muted-foreground">{t("preview.recurring.stillToPay")}</span>
				<span className="font-mono font-semibold text-foreground">{fmt.money(-74.99, { decimals: 2 })}</span>
			</div>
		</PreviewFrame>
	);
}

export function AssistantPreview() {
	const { t } = useTranslations();
	const fmt = usePreviewFormat();

	return (
		<PreviewFrame title={t("preview.assistant.title")}>
			<div className="mt-4 space-y-3">
				<p className="ml-auto w-fit max-w-[85%] rounded-xl bg-paper-3 px-4 py-2.5 text-sm text-foreground">
					{t("preview.assistant.question")}
				</p>
				<p className="w-fit max-w-[90%] rounded-xl border border-border bg-muted/60 px-4 py-2.5 text-sm leading-6 text-ink-2">
					{t("preview.assistant.answer", { amount: fmt.money(184.6, { decimals: 2 }), count: 9 })}
				</p>
				<div className="rounded-xl border border-border px-4 py-3">
					<p className="text-xs text-muted-foreground">{t("preview.assistant.proposalLabel")}</p>
					<p className="mt-1 text-sm text-foreground">{t("preview.assistant.proposal")}</p>
					<div className="mt-3 flex gap-2" aria-hidden="true">
						<span className="inline-flex items-center gap-1 rounded-md border border-input px-3 py-1 text-xs font-medium text-foreground">
							<Check className="h-3.5 w-3.5" />
							{t("preview.assistant.apply")}
						</span>
						<span className="inline-flex items-center rounded-md px-3 py-1 text-xs text-muted-foreground">
							{t("preview.assistant.dismiss")}
						</span>
					</div>
				</div>
			</div>
		</PreviewFrame>
	);
}

export function MultiCurrencyPreview() {
	const { t } = useTranslations();
	const fmt = usePreviewFormat();
	const accounts = [
		{ nameKey: "preview.currencies.account1", original: fmt.money(2450, { decimals: 2 }), converted: null, estimated: false },
		{
			nameKey: "preview.currencies.account2",
			original: fmt.money(1200, { currency: "USD", decimals: 2 }),
			converted: fmt.money(1032, { decimals: 2 }),
			estimated: false,
		},
		{
			nameKey: "preview.currencies.account3",
			original: fmt.money(800, { currency: "GBP", decimals: 2 }),
			converted: fmt.money(920, { decimals: 2 }),
			estimated: true,
		},
	];

	return (
		<PreviewFrame title={t("preview.currencies.title")}>
			<div className="mt-4 space-y-2">
				{accounts.map((account) => (
					<Row key={account.nameKey}>
						<div className="flex min-w-0 items-center gap-2">
							<span className="truncate text-sm text-ink-2">{t(account.nameKey)}</span>
							{account.estimated ? <Badge tone="warning">{t("preview.currencies.estimated")}</Badge> : null}
						</div>
						<div className="shrink-0 text-right">
							<p className="font-mono text-sm font-semibold text-foreground">{account.converted ?? account.original}</p>
							{account.converted ? <p className="font-mono text-[11px] text-muted-foreground">{account.original}</p> : null}
						</div>
					</Row>
				))}
			</div>
			<div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
				<span className="text-muted-foreground">{t("preview.currencies.total")}</span>
				<span className="font-mono font-semibold text-foreground">{fmt.money(4402, { decimals: 2 })}</span>
			</div>
			<p className="mt-2 text-[11px] text-muted-foreground">{t("preview.currencies.rateNote")}</p>
		</PreviewFrame>
	);
}

export function SelfHostingPreview() {
	const { t } = useTranslations();
	const services = ["preview.selfHosting.database", "preview.selfHosting.api", "preview.selfHosting.worker", "preview.selfHosting.web"];

	return (
		<PreviewFrame title={t("preview.selfHosting.title")}>
			<p className="mt-1 text-xs text-muted-foreground">{t("preview.selfHosting.subtitle")}</p>
			<div className="mt-4 space-y-2">
				{services.map((serviceKey) => (
					<Row key={serviceKey}>
						<span className="truncate text-sm text-ink-2">{t(serviceKey)}</span>
						<span className="flex shrink-0 items-center gap-2 text-xs text-success-text">
							<span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
							{t("preview.selfHosting.running")}
						</span>
					</Row>
				))}
			</div>
			<div className="mt-3 border-t border-border pt-3 text-[11px] text-muted-foreground">{t("preview.selfHosting.note")}</div>
		</PreviewFrame>
	);
}

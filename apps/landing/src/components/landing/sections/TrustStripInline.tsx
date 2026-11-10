import { useTranslations } from "@/lib/reactTranslations";

export default function TrustStripInline() {
	const { t } = useTranslations();

	const items = [
		t("lp.shared.trustInline.readOnly"),
		t("lp.shared.trustInline.madeIn"),
		t("lp.shared.trustInline.cancelAnyTime"),
	];

	return (
		<div className="border-y border-border bg-paper-2/50 py-4">
			<div className="mx-auto w-full max-w-6xl px-6 sm:px-8">
				<div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs text-muted-foreground sm:text-sm">
					{items.map((item, index) => (
						<span key={item} className="flex items-center">
							{item}
							{index < items.length - 1 && (
								<span className="ml-3 inline-block h-3.5 w-px bg-input" aria-hidden="true" />
							)}
						</span>
					))}
				</div>
			</div>
		</div>
	);
}

import { useTranslations } from "@/lib/reactTranslations";

export default function TrademarkDisclaimer({ textKey }: { textKey: string }) {
  const { t } = useTranslations();
  return (
    <p className="mx-auto max-w-3xl px-1 text-center text-xs text-muted-foreground">
      {t(textKey)}
    </p>
  );
}

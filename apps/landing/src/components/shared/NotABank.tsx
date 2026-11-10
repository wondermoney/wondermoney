import { Info } from "lucide-react";
import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

export default function NotABank({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <NotABankContent />
    </ReactTranslationsProvider>
  );
}

function NotABankContent() {
  const { t } = useTranslations();

  return (
    <div
      role="note"
      className="mx-auto flex max-w-3xl gap-3 rounded-lg border border-border bg-background px-5 py-4 text-xs text-muted-foreground"
    >
      <Info
        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <p>{t("global.notABank")}</p>
    </div>
  );
}

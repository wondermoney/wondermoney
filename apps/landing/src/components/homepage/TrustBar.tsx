import { Shield, Lock, Landmark, CreditCard } from "lucide-react";
import { useTranslations } from "@/lib/reactTranslations";
import flag from "../../assets/flag/pt.svg";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

export default function TrustBar({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <TrustBarContent />
    </ReactTranslationsProvider>
  );
}

function TrustBarContent() {
  const { t } = useTranslations();

  return (
    <div className="bg-paper-2 border-y border-border py-4">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-muted-foreground text-sm">
          <div className="flex items-center gap-1.5">
            <CreditCard className="h-4 w-4" />
            <span>{t("homepage.trustBar.gocardless")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Landmark className="h-4 w-4" />
            <span>{t("homepage.trustBar.openBanking")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Shield className="h-4 w-4" />
            <span>{t("homepage.trustBar.gdpr")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Lock className="h-4 w-4" />
            <span>{t("homepage.trustBar.readOnly")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <img src={flag.src} alt="Portuguese flag" className="h-4 w-auto" />
            <span>{t("homepage.trustBar.madeIn")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

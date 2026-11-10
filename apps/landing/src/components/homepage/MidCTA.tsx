import SectionHighlight from "../shared/SectionHighlight";
import { Button } from "../ui/button";
import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { useCtaUrl } from "@/hooks/useCtaUrl";
import { pushGtmEvent, getPageType } from "@/lib/gtm";

export default function MidCTA({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <MidCTAContent />
    </ReactTranslationsProvider>
  );
}

function MidCTAContent() {
  const { t } = useTranslations();
  const ctaUrl = useCtaUrl();

  return (
    <SectionHighlight
      title={t("homepage.midCta.headline")}
      subTitle={t("homepage.midCta.subheadline")}
    >
      <div className="mt-10 flex flex-col items-center justify-center gap-3">
        <Button asChild>
          <a
            href={ctaUrl}
            onClick={() =>
              pushGtmEvent({
                event: "cta_click",
                cta_position: "mid_cta",
                page_type: getPageType(),
              })
            }
          >
            {t("global.mainCta")}
          </a>
        </Button>
        <p className="text-sm text-muted-foreground">
          {t("homepage.midCta.microcopy")}
        </p>
      </div>
    </SectionHighlight>
  );
}

import SectionHighlight from "../shared/SectionHighlight";
import { Button } from "../ui/button";
import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { useCtaUrl } from "@/hooks/useCtaUrl";
import { pushGtmEvent, getPageType } from "@/lib/gtm";

export default function BottomCTA({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <BottomCTAContent />
    </ReactTranslationsProvider>
  );
}

function BottomCTAContent() {
  const { t } = useTranslations();
  const ctaUrl = useCtaUrl();

  return (
    <SectionHighlight
      preTitle={t("bottomCta.pretitle")}
      title={t("bottomCta.headline")}
      subTitle={t("bottomCta.subheadline")}
      className="lg:pb-16"
    >
      <div className="mt-16 flex flex-col md:flex-row items-center justify-center gap-6">
        <Button asChild>
          <a
            href={ctaUrl}
            onClick={() =>
              pushGtmEvent({
                event: "cta_click",
                cta_position: "about_trial_cta",
                page_type: getPageType(),
              })
            }
          >
            {t("global.mainCta")}
          </a>
        </Button>
        {/* <Button asChild variant="link" className="text-primary-foreground">
          <a href="/features">
            {t("global.secondaryCta")}{" "}
            <span aria-hidden="true">
              <ChevronRight size="20" />
            </span>
          </a>
        </Button> */}
      </div>
    </SectionHighlight>
  );
}

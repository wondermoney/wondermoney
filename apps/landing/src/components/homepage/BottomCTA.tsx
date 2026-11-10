import BackgroundPattern from "./BackgroundPattern";
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

// The hero's action again, in one short band.
function BottomCTAContent() {
  const { t } = useTranslations();
  const ctaUrl = useCtaUrl();

  return (
    <section className="relative isolate border-t border-border bg-paper-2">
      <BackgroundPattern pattern="dots" fade="center" />
      <div className="mx-auto grid max-w-7xl items-end gap-10 px-6 py-24 lg:grid-cols-12 lg:gap-10 lg:px-8 lg:py-32">
        <div className="min-w-0 lg:col-span-7">
          <h2 className="text-4xl font-semibold leading-[1.08] tracking-[-0.02em] text-foreground sm:text-5xl lg:text-[3.25rem]">
            {t("bottomCta.headline")}
          </h2>
          <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
            {t("bottomCta.subheadline")}
          </p>
        </div>
        <div className="flex min-w-0 flex-col items-start gap-3 lg:col-span-4 lg:col-start-9 lg:items-end">
          <Button asChild size="lg" className="px-6">
            <a
              href={ctaUrl}
              onClick={() =>
                pushGtmEvent({
                  event: "cta_click",
                  cta_position: "bottom_cta",
                  page_type: getPageType(),
                })
              }
            >
              {t("global.mainCta")}
            </a>
          </Button>
          <p className="text-sm text-muted-foreground">
            {t("bottomCta.microcopy")}
          </p>
        </div>
      </div>
    </section>
  );
}

import BackgroundPattern from "./BackgroundPattern";
import { Button } from "../ui/button";
import HeroMosaic from "./previews/HeroMosaic";
import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { useCtaUrl } from "@/hooks/useCtaUrl";
import { pushGtmEvent, getPageType } from "@/lib/gtm";

export default function Hero({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <HeroContent />
    </ReactTranslationsProvider>
  );
}

// The headline, its line and the action on five columns, the net worth card on
// seven; all of it inside the first screen at 1280 x 800.
function HeroContent() {
  const { t } = useTranslations();
  const ctaUrl = useCtaUrl();

  return (
    <section className="relative isolate bg-background">
      <BackgroundPattern pattern="grid" fade="top" />
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-16 lg:grid-cols-12 lg:gap-10 lg:px-8 lg:py-24">
        <div className="min-w-0 lg:col-span-5">
          <h1 className="text-[clamp(2.5rem,3.6vw+0.75rem,4.25rem)] font-semibold leading-[1.04] tracking-[-0.03em] text-foreground [text-wrap:balance]">
            {t("homepage.hero.newHeadline")}
          </h1>
          <p className="mt-6 max-w-md text-lg leading-8 text-muted-foreground">
            {t("homepage.hero.newSubheadline")}
          </p>
          <div className="mt-9 flex flex-col items-start gap-3">
            <Button asChild size="lg" className="px-6">
              <a
                href={ctaUrl}
                onClick={() =>
                  pushGtmEvent({
                    event: "cta_click",
                    cta_position: "homepage_hero",
                    page_type: getPageType(),
                  })
                }
              >
                {t("homepage.hero.newCta")}
              </a>
            </Button>
            <p className="text-sm text-muted-foreground">
              {t("global.mainCtaMicrocopy")}
            </p>
          </div>
        </div>
        <div className="min-w-0 lg:col-span-7">
          <HeroMosaic />
        </div>
      </div>
    </section>
  );
}

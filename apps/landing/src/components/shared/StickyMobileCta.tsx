import { useTranslations } from "@/lib/reactTranslations";
import { Button } from "@/components/ui/button";
import { useCtaUrl } from "@/hooks/useCtaUrl";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

export default function StickyMobileCta({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <StickyMobileCtaContent />
    </ReactTranslationsProvider>
  );
}

function StickyMobileCtaContent() {
  const { t } = useTranslations();
  const ctaUrl = useCtaUrl();

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-2xl items-center gap-3">
        <Button asChild size="lg" className="flex-1">
          <a
            href={ctaUrl}
            onClick={() =>
              pushGtmEvent({
                event: "cta_click",
                cta_position: "sticky_mobile",
                page_type: getPageType(),
              })
            }
          >
            {t("global.mainCta")}
          </a>
        </Button>
        <a
          href="https://app.wonder.money/auth/login"
          className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-accent"
        >
          {t("header.login")}
        </a>
      </div>
      <p className="mx-auto mt-1 max-w-2xl text-center text-xs text-muted-foreground">
        {t("global.mainCtaMicrocopy")}
      </p>
    </div>
  );
}

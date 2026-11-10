import { useTranslations } from "@/lib/reactTranslations";
import { Button } from "../ui/button";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { CTA_URL } from "@/hooks/useCtaUrl";

export type Props = {
  headline?: string;
  description?: string;
  ctaText?: string;
  ctaHref?: string;
  /** Optional short line under the button, e.g. "No signup needed." */
  ctaNote?: string;
  locale?: Lang;
};

export default function CTABanner({
  headline,
  description,
  ctaText,
  ctaHref = CTA_URL,
  ctaNote,
  locale,
}: Props) {
  if (locale) {
    return (
      <ReactTranslationsProvider locale={locale}>
        <CTABannerContent
          headline={headline}
          description={description}
          ctaText={ctaText}
          ctaHref={ctaHref}
          ctaNote={ctaNote}
        />
      </ReactTranslationsProvider>
    );
  }

  return (
    <CTABannerContent
      headline={headline}
      description={description}
      ctaText={ctaText}
      ctaHref={ctaHref}
      ctaNote={ctaNote}
    />
  );
}

function CTABannerContent({
  headline,
  description,
  ctaText,
  ctaHref = CTA_URL,
  ctaNote,
}: Omit<Props, "locale">) {
  const { t } = useTranslations();

  return (
    <section className="rounded-2xl border border-border bg-paper-2 px-6 py-16 text-center sm:px-12 lg:px-16">
      <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        {headline || t("global.ctaBanner.headline")}
      </h2>
      <p className="mx-auto mt-4 max-w-xl text-lg leading-8 text-muted-foreground">
        {description || t("global.ctaBanner.description")}
      </p>
      <div className="mt-8 flex flex-col items-center gap-3">
        <Button asChild size="lg">
          <a
            href={ctaHref}
            onClick={() =>
              pushGtmEvent({
                event: "cta_click",
                cta_position: "cta_banner",
                page_type: getPageType(),
              })
            }
          >
            {ctaText || t("global.mainCta")}
          </a>
        </Button>
        {ctaNote && <p className="text-sm text-muted-foreground">{ctaNote}</p>}
        <p className="text-sm text-muted-foreground">
          {t("global.mainCtaMicrocopy")}
        </p>
      </div>
    </section>
  );
}

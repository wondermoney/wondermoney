import { useTranslations } from "@/lib/reactTranslations";
import { Button } from "../ui/button";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { appSignupUrl } from "@/lib/appLinks";

export type Props = {
  headline?: string;
  description?: string;
  ctaText?: string;
  ctaHref?: string;
  /** Optional short line under the button, e.g. "No signup needed." */
  ctaNote?: string;
  /** `banner`: the centred closing band. `card`: a bordered card at the end of an article (Direction B). */
  variant?: "banner" | "card";
  locale?: Lang;
};

export default function CTABanner({
  headline,
  description,
  ctaText,
  ctaHref,
  ctaNote,
  variant,
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
          variant={variant}
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
      variant={variant}
    />
  );
}

function CTABannerContent({
  headline,
  description,
  ctaText,
  ctaHref,
  ctaNote,
  variant = "banner",
}: Omit<Props, "locale">) {
  const { t, locale } = useTranslations();
  const action = (
    <Button
      asChild
      size={variant === "card" ? "default" : "lg"}
      // A long next-step label wraps inside the card on a phone instead of pushing past it.
      className={variant === "card" ? "h-auto min-h-10 max-w-full whitespace-normal py-2 text-center" : undefined}
    >
      <a
        href={ctaHref ?? appSignupUrl(locale)}
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
  );

  if (variant === "card") {
    return (
      <section className="flex flex-col gap-6 rounded-card border border-border bg-card p-6 sm:p-8 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 max-w-xl">
          <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {headline || t("global.ctaBanner.headline")}
          </h2>
          <p className="mt-2 text-base leading-7 text-muted-foreground">
            {description || t("global.ctaBanner.description")}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
          {action}
          {ctaNote && <p className="text-sm text-muted-foreground">{ctaNote}</p>}
          <p className="text-sm text-muted-foreground">{t("global.mainCtaMicrocopy")}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-paper-2 px-6 py-16 text-center sm:px-12 lg:px-16">
      <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        {headline || t("global.ctaBanner.headline")}
      </h2>
      <p className="mx-auto mt-4 max-w-xl text-lg leading-8 text-muted-foreground">
        {description || t("global.ctaBanner.description")}
      </p>
      <div className="mt-8 flex flex-col items-center gap-3">
        {action}
        {ctaNote && <p className="text-sm text-muted-foreground">{ctaNote}</p>}
        <p className="text-sm text-muted-foreground">
          {t("global.mainCtaMicrocopy")}
        </p>
      </div>
    </section>
  );
}

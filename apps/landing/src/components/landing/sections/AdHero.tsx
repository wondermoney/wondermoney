import { useTranslations } from "@/lib/reactTranslations";
import { Button } from "@/components/ui/button";
import { useCtaUrl } from "@/hooks/useCtaUrl";
import { pushGtmEvent, getPageType } from "@/lib/gtm";

type Props = {
  badge: string;
  titleKey: string;
  subtitleKey: string;
  /** Overrides the default "lp.shared.ctaPrimary" button label — used by campaign-specific pages. */
  ctaLabelKey?: string;
  /** Optional short line under the CTA row, e.g. "No signup needed." */
  ctaNoteKey?: string;
};

export default function AdHero({ badge, titleKey, subtitleKey, ctaLabelKey = "lp.shared.ctaPrimary", ctaNoteKey }: Props) {
  const { t } = useTranslations();
  const ctaUrl = useCtaUrl();

  return (
    <section className="bg-background py-20 md:py-28">
      <div className="relative mx-auto max-w-4xl px-6 text-center lg:px-8">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl [text-wrap:balance]">
          <span className="mb-3 block text-xl tracking-normal text-foreground">{badge}</span>{" "}
          {t(titleKey)}
        </h1>

        <p className="mt-5 text-lg leading-8 text-muted-foreground max-w-2xl mx-auto">
          {t(subtitleKey)}
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button asChild size="lg">
            <a
              href={ctaUrl}
              onClick={() => pushGtmEvent({ event: "cta_click", cta_position: "hero", page_type: getPageType() })}
            >
              {t(ctaLabelKey)}
            </a>
          </Button>
          <p className="text-sm text-muted-foreground">{t("lp.shared.trialNote")}</p>
        </div>
        {ctaNoteKey && (
          <p className="mt-3 text-sm text-muted-foreground">{t(ctaNoteKey)}</p>
        )}
      </div>
    </section>
  );
}

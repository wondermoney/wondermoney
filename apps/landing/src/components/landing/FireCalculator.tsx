import { useTranslations } from "@/lib/reactTranslations";
import { Button } from "@/components/ui/button";
import CTABanner from "@/components/shared/CTABanner";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { CTA_URL } from "@/hooks/useCtaUrl";

function TrackCard({
  number,
  title,
  body,
}: {
  number: number;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-5">
      <div className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-sm">
        {number}
      </div>
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

export default function FireCalculator({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <FireCalculatorContent />
    </ReactTranslationsProvider>
  );
}

function FireCalculatorContent() {
  const { t } = useTranslations();

  return (
    <>
      {/* Hero */}
      <section className="bg-background py-16 md:py-24">
        <div className="mx-auto max-w-4xl px-6 text-center lg:px-8">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl [text-wrap:balance]">
            <span className="mb-3 block text-xl tracking-normal text-foreground">{t("lp.fireCalculator.eyebrow")}</span>{" "}
            {t("lp.fireCalculator.heroTitle")}
          </h1>
          <p className="mt-5 text-lg leading-8 text-muted-foreground max-w-2xl mx-auto">
            {t("lp.fireCalculator.heroSubtitle")}
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button asChild size="lg">
              <a
                href={CTA_URL}
                onClick={() => pushGtmEvent({ event: "cta_click", cta_position: "hero", page_type: getPageType() })}
              >
                {t("lp.shared.ctaPrimary")}
              </a>
            </Button>
            <p className="text-sm text-muted-foreground">{t("lp.shared.trialNote")}</p>
          </div>
        </div>
      </section>

      {/* What Is FIRE */}
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground mb-6">
            {t("lp.fireCalculator.whatTitle")}
          </h2>
          <p className="text-muted-foreground leading-7 mb-4">
            {t("lp.fireCalculator.whatBody1")}
          </p>
          <p className="text-muted-foreground leading-7 mb-4">
            {t("lp.fireCalculator.whatBody2")}
          </p>
          <p className="max-w-[60ch] text-muted-foreground leading-7">
            {t("lp.fireCalculator.whatBody3")}
          </p>
        </div>
      </section>

      {/* Calculator embed */}
      <section className="py-16 md:py-20 bg-paper-2">
        <div className="mx-auto max-w-3xl px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground mb-4">
            {t("lp.fireCalculator.calcTitle")}
          </h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            {t("lp.fireCalculator.calcBody")}
          </p>
          <Button asChild size="lg" variant="outline" className="border-primary/40 text-primary hover:bg-accent">
            <a href="https://fuckyou.money" target="_blank" rel="noopener noreferrer">
              {t("lp.fireCalculator.calcCta")}
            </a>
          </Button>
          <p className="mt-3 max-w-md mx-auto text-xs text-muted-foreground">{t("lp.fireCalculator.calcNote")}</p>
        </div>
      </section>

      {/* Track Progress */}
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              {t("lp.fireCalculator.trackTitle")}
            </h2>
          </div>
          <div className="flex flex-col gap-10">
            <TrackCard
              number={1}
              title={t("lp.fireCalculator.track1Title")}
              body={t("lp.fireCalculator.track1Body")}
            />
            <TrackCard
              number={2}
              title={t("lp.fireCalculator.track2Title")}
              body={t("lp.fireCalculator.track2Body")}
            />
            <TrackCard
              number={3}
              title={t("lp.fireCalculator.track3Title")}
              body={t("lp.fireCalculator.track3Body")}
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-8 pb-16 md:pb-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <CTABanner
            headline={t("lp.fireCalculator.ctaHeadline")}
            description={t("lp.fireCalculator.ctaBody")}
          />
        </div>
      </section>
    </>
  );
}

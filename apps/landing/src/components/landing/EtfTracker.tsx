import { useTranslations } from "@/lib/reactTranslations";
import { Button } from "@/components/ui/button";
import CTABanner from "@/components/shared/CTABanner";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { CTA_URL } from "@/hooks/useCtaUrl";

function StepCard({
  number,
  title,
  body,
}: {
  number: number;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-4 rounded-card border border-border bg-background p-8">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-sm">
        {number}
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

function FeatureCard({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-card border border-border bg-primary/10 p-6">
      <h3 className="text-base font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

export default function EtfTracker({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <EtfTrackerContent />
    </ReactTranslationsProvider>
  );
}

function EtfTrackerContent() {
  const { t } = useTranslations();

  return (
    <>
      {/* Hero */}
      <section className="bg-background py-16 md:py-24">
        <div className="mx-auto max-w-4xl px-6 text-center lg:px-8">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl [text-wrap:balance]">
            <span className="mb-3 block text-xl tracking-normal text-foreground">{t("lp.etfTracker.eyebrow")}</span>{" "}
            {t("lp.etfTracker.heroTitle")}
          </h1>
          <p className="mt-5 text-lg leading-8 text-muted-foreground max-w-2xl mx-auto">
            {t("lp.etfTracker.heroSubtitle")}
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

      {/* How It Works */}
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              {t("lp.etfTracker.howTitle")}
            </h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            <StepCard number={1} title={t("lp.etfTracker.step1Title")} body={t("lp.etfTracker.step1Body")} />
            <StepCard number={2} title={t("lp.etfTracker.step2Title")} body={t("lp.etfTracker.step2Body")} />
            <StepCard number={3} title={t("lp.etfTracker.step3Title")} body={t("lp.etfTracker.step3Body")} />
          </div>
        </div>
      </section>

      {/* What It Shows */}
      <section className="py-16 md:py-20 bg-paper-2">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              {t("lp.etfTracker.featuresTitle")}
            </h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard title={t("lp.etfTracker.feature1Title")} body={t("lp.etfTracker.feature1Body")} />
            <FeatureCard title={t("lp.etfTracker.feature2Title")} body={t("lp.etfTracker.feature2Body")} />
            <FeatureCard title={t("lp.etfTracker.feature3Title")} body={t("lp.etfTracker.feature3Body")} />
            <FeatureCard title={t("lp.etfTracker.feature4Title")} body={t("lp.etfTracker.feature4Body")} />
            <FeatureCard title={t("lp.etfTracker.feature5Title")} body={t("lp.etfTracker.feature5Body")} />
          </div>
        </div>
      </section>

      {/* Broker support */}
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground mb-4">
            {t("lp.etfTracker.brokerTitle")}
          </h2>
          <p className="max-w-[60ch] text-muted-foreground leading-7">
            {t("lp.etfTracker.brokerBody")}
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="py-8 pb-16 md:pb-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <CTABanner
            headline={t("lp.etfTracker.ctaHeadline")}
            description={t("lp.etfTracker.ctaBody")}
          />
        </div>
      </section>
    </>
  );
}

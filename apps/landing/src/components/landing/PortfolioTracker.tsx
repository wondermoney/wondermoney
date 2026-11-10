import { useTranslations } from "@/lib/reactTranslations";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import CTABanner from "@/components/shared/CTABanner";
import TrademarkDisclaimer from "@/components/shared/TrademarkDisclaimer";
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

function BrokerCard({
  title,
  body,
  logoLabel,
}: {
  title: string;
  body: string;
  logoLabel: string;
}) {
  return (
    <div className="rounded-card border border-primary/20 bg-primary/10 p-8">
      <h3 className="text-lg font-semibold text-foreground mb-3">
        <span className="mb-2 block text-sm tracking-normal text-foreground">{logoLabel}</span>{" "}
        {title}
      </h3>
      <p className="text-sm leading-7 text-muted-foreground">{body}</p>
    </div>
  );
}

function FeatureItem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3">
      <Check className="mt-0.5 h-5 w-5 shrink-0 text-success-text" aria-hidden="true" />
      <span className="text-muted-foreground text-sm">{text}</span>
    </div>
  );
}

export default function PortfolioTracker({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <PortfolioTrackerContent />
    </ReactTranslationsProvider>
  );
}

function PortfolioTrackerContent() {
  const { t } = useTranslations();

  const features = [
    t("lp.portfolioTracker.feature1"),
    t("lp.portfolioTracker.feature2"),
    t("lp.portfolioTracker.feature3"),
    t("lp.portfolioTracker.feature4"),
    t("lp.portfolioTracker.feature5"),
    t("lp.portfolioTracker.feature6"),
  ];

  return (
    <>
      {/* Hero */}
      <section className="bg-background py-16 md:py-24">
        <div className="mx-auto max-w-4xl px-6 text-center lg:px-8">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl [text-wrap:balance]">
            <span className="mb-3 block text-xl tracking-normal text-foreground">{t("lp.portfolioTracker.eyebrow")}</span>{" "}
            {t("lp.portfolioTracker.heroTitle")}
          </h1>
          <p className="mt-5 text-lg leading-8 text-muted-foreground max-w-2xl mx-auto">
            {t("lp.portfolioTracker.heroSubtitle")}
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
              {t("lp.portfolioTracker.howWorksTitle")}
            </h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            <StepCard
              number={1}
              title={t("lp.portfolioTracker.step1Title")}
              body={t("lp.portfolioTracker.step1Body")}
            />
            <StepCard
              number={2}
              title={t("lp.portfolioTracker.step2Title")}
              body={t("lp.portfolioTracker.step2Body")}
            />
            <StepCard
              number={3}
              title={t("lp.portfolioTracker.step3Title")}
              body={t("lp.portfolioTracker.step3Body")}
            />
          </div>
        </div>
      </section>

      {/* Broker-specific */}
      <section className="py-16 md:py-20 bg-paper-2">
        <div className="mx-auto max-w-4xl px-6 lg:px-8">
          <div className="grid gap-6 md:grid-cols-2">
            <BrokerCard
              logoLabel="DEGIRO"
              title={t("lp.portfolioTracker.degiroTitle")}
              body={t("lp.portfolioTracker.degiroBody")}
            />
            <BrokerCard
              logoLabel="Interactive Brokers"
              title={t("lp.portfolioTracker.ibkrTitle")}
              body={t("lp.portfolioTracker.ibkrBody")}
            />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground mb-10 text-center">
            {t("lp.portfolioTracker.featuresTitle")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {features.map((f, i) => (
              <FeatureItem key={i} text={f} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-8 pb-16 md:pb-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <CTABanner
            headline={t("lp.portfolioTracker.ctaHeadline")}
            description={t("lp.portfolioTracker.ctaBody")}
          />
          <div className="mt-8">
            <TrademarkDisclaimer textKey="lp.trademarks.tmDegiroIbkr" />
          </div>
        </div>
      </section>
    </>
  );
}

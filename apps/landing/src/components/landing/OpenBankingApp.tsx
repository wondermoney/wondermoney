import { useTranslations } from "@/lib/reactTranslations";
import { Button } from "@/components/ui/button";
import CTABanner from "@/components/shared/CTABanner";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { Check, Landmark } from "lucide-react";
import ResearchNote from "@/components/landing/sections/ResearchNote";
import { CTA_URL } from "@/hooks/useCtaUrl";

function FeatureCard({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-card border border-border bg-background p-6">
      <Check className="mb-3 h-6 w-6 text-success-text" aria-hidden="true" />
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

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

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className="border-b border-border py-6 last:border-0">
      <h3 className="text-base font-semibold text-foreground mb-2">{q}</h3>
      <p className="text-sm leading-7 text-muted-foreground">{a}</p>
    </div>
  );
}

export default function OpenBankingApp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <OpenBankingAppContent />
    </ReactTranslationsProvider>
  );
}

function OpenBankingAppContent() {
  const { t } = useTranslations();

  const features = [1, 2, 3, 4, 5, 6].map((n) => ({
    title: t(`lp.openBankingApp.feature${n}Title`),
    body: t(`lp.openBankingApp.feature${n}Body`),
  }));

  return (
    <>
      {/* Hero */}
      <section className="bg-background py-16 md:py-24">
        <div className="mx-auto max-w-4xl px-6 text-center lg:px-8">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl [text-wrap:balance]">
            <span className="mb-3 block text-xl tracking-normal text-foreground">{t("lp.openBankingApp.eyebrow")}</span>{" "}
            {t("lp.openBankingApp.heroTitle")}
          </h1>
          <p className="mt-5 text-lg leading-8 text-muted-foreground max-w-2xl mx-auto">
            {t("lp.openBankingApp.heroSubtitle")}
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

      {/* Features */}
      <section className="py-16 md:py-20 bg-paper-2">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center mb-12">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              {t("lp.openBankingApp.featuresTitle")}
            </h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {features.map((feature, i) => (
              <FeatureCard key={i} title={feature.title} body={feature.body} />
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              {t("lp.openBankingApp.howTitle")}
            </h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            <StepCard number={1} title={t("lp.openBankingApp.how1Title")} body={t("lp.openBankingApp.how1Body")} />
            <StepCard number={2} title={t("lp.openBankingApp.how2Title")} body={t("lp.openBankingApp.how2Body")} />
            <StepCard number={3} title={t("lp.openBankingApp.how3Title")} body={t("lp.openBankingApp.how3Body")} />
          </div>
          {/*
            After the mechanism, the scale. Everything above explains how the
            connection works; the remaining objection is whether anyone else is
            actually doing it, and that answers to a cited number rather than
            more of our own copy.
          */}
          <div className="mt-12">
            <ResearchNote
              icon={Landmark}
              noteKey="lp.shared.openBankingScaleNote"
              sourceKey="lp.shared.openBankingScaleSource"
            />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 md:py-20 bg-paper-2">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground text-center mb-6">
            {t("lp.openBankingApp.faqTitle")}
          </h2>
          <FaqItem q={t("lp.openBankingApp.faq1Q")} a={t("lp.openBankingApp.faq1A")} />
          <FaqItem q={t("lp.openBankingApp.faq2Q")} a={t("lp.openBankingApp.faq2A")} />
          <FaqItem q={t("lp.openBankingApp.faq3Q")} a={t("lp.openBankingApp.faq3A")} />
          <FaqItem q={t("lp.openBankingApp.faq4Q")} a={t("lp.openBankingApp.faq4A")} />
        </div>
      </section>

      {/* CTA */}
      <section className="py-8 pb-16 md:pb-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <CTABanner
            headline={t("lp.openBankingApp.ctaHeadline")}
            description={t("lp.openBankingApp.ctaBody")}
          />
        </div>
      </section>
    </>
  );
}

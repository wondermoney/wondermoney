import { useTranslations } from "@/lib/reactTranslations";
import { Button } from "@/components/ui/button";
import CTABanner from "@/components/shared/CTABanner";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { Check } from "lucide-react";
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

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className="border-b border-border py-6 last:border-0">
      <h3 className="text-base font-semibold text-foreground mb-2">{q}</h3>
      <p className="text-sm leading-7 text-muted-foreground">{a}</p>
    </div>
  );
}

export default function PersonalFinanceApp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <PersonalFinanceAppContent />
    </ReactTranslationsProvider>
  );
}

function PersonalFinanceAppContent() {
  const { t } = useTranslations();

  const features = [1, 2, 3, 4, 5, 6].map((n) => ({
    title: t(`lp.personalFinanceApp.feature${n}Title`),
    body: t(`lp.personalFinanceApp.feature${n}Body`),
  }));

  return (
    <>
      {/* Hero */}
      <section className="bg-background py-16 md:py-24">
        <div className="mx-auto max-w-4xl px-6 text-center lg:px-8">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl [text-wrap:balance]">
            <span className="mb-3 block text-xl tracking-normal text-foreground">{t("lp.personalFinanceApp.eyebrow")}</span>{" "}
            {t("lp.personalFinanceApp.heroTitle")}
          </h1>
          <p className="mt-5 text-lg leading-8 text-muted-foreground max-w-2xl mx-auto">
            {t("lp.personalFinanceApp.heroSubtitle")}
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
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center mb-12">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              {t("lp.personalFinanceApp.featuresTitle")}
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
      <section className="py-16 md:py-20 bg-paper-2">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              {t("lp.personalFinanceApp.howTitle")}
            </h2>
          </div>
          <div className="flex flex-col gap-10">
            <StepCard
              number={1}
              title={t("lp.personalFinanceApp.how1Title")}
              body={t("lp.personalFinanceApp.how1Body")}
            />
            <StepCard
              number={2}
              title={t("lp.personalFinanceApp.how2Title")}
              body={t("lp.personalFinanceApp.how2Body")}
            />
            <StepCard
              number={3}
              title={t("lp.personalFinanceApp.how3Title")}
              body={t("lp.personalFinanceApp.how3Body")}
            />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground text-center mb-6">
            {t("lp.personalFinanceApp.faqTitle")}
          </h2>
          <FaqItem q={t("lp.personalFinanceApp.faq1Q")} a={t("lp.personalFinanceApp.faq1A")} />
          <FaqItem q={t("lp.personalFinanceApp.faq2Q")} a={t("lp.personalFinanceApp.faq2A")} />
          <FaqItem q={t("lp.personalFinanceApp.faq3Q")} a={t("lp.personalFinanceApp.faq3A")} />
          <FaqItem q={t("lp.personalFinanceApp.faq4Q")} a={t("lp.personalFinanceApp.faq4A")} />
        </div>
      </section>

      {/* CTA */}
      <section className="py-8 pb-16 md:pb-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <CTABanner
            headline={t("lp.personalFinanceApp.ctaHeadline")}
            description={t("lp.personalFinanceApp.ctaBody")}
          />
        </div>
      </section>
    </>
  );
}

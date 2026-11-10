import { useTranslations } from "@/lib/reactTranslations";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import CTABanner from "@/components/shared/CTABanner";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { CTA_URL } from "@/hooks/useCtaUrl";

function FeatureItem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3">
      <Check className="mt-0.5 h-5 w-5 shrink-0 text-success-text" aria-hidden="true" />
      <span className="text-muted-foreground text-sm">{text}</span>
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

export default function NetWorthTracker({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <NetWorthTrackerContent />
    </ReactTranslationsProvider>
  );
}

function NetWorthTrackerContent() {
  const { t } = useTranslations();

  const features = [
    t("lp.netWorthTracker.feature1"),
    t("lp.netWorthTracker.feature2"),
    t("lp.netWorthTracker.feature3"),
    t("lp.netWorthTracker.feature4"),
    t("lp.netWorthTracker.feature5"),
    t("lp.netWorthTracker.feature6"),
  ];

  return (
    <>
      {/* Hero */}
      <section className="bg-background py-16 md:py-24">
        <div className="mx-auto max-w-4xl px-6 text-center lg:px-8">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl [text-wrap:balance]">
            <span className="mb-3 block text-xl tracking-normal text-foreground">{t("lp.netWorthTracker.eyebrow")}</span>{" "}
            {t("lp.netWorthTracker.heroTitle")}
          </h1>
          <p className="mt-5 text-lg leading-8 text-muted-foreground max-w-2xl mx-auto">
            {t("lp.netWorthTracker.heroSubtitle")}
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

      {/* What Is Net Worth */}
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground mb-6">
            {t("lp.netWorthTracker.whatTitle")}
          </h2>
          <p className="text-muted-foreground leading-7 mb-4">
            {t("lp.netWorthTracker.whatBody1")}
          </p>
          <p className="text-muted-foreground leading-7 mb-8">
            {t("lp.netWorthTracker.whatBody2")}
          </p>
          <div className="rounded-card bg-primary/10 border border-primary/20 px-8 py-5 text-center">
            <p className="text-primary font-semibold text-lg">
              {t("lp.netWorthTracker.formulaLabel")}
            </p>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 md:py-20 bg-paper-2">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              {t("lp.netWorthTracker.howTitle")}
            </h2>
          </div>
          <div className="flex flex-col gap-10">
            <StepCard
              number={1}
              title={t("lp.netWorthTracker.how1Title")}
              body={t("lp.netWorthTracker.how1Body")}
            />
            <StepCard
              number={2}
              title={t("lp.netWorthTracker.how2Title")}
              body={t("lp.netWorthTracker.how2Body")}
            />
            <StepCard
              number={3}
              title={t("lp.netWorthTracker.how3Title")}
              body={t("lp.netWorthTracker.how3Body")}
            />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground mb-10 text-center">
            {t("lp.netWorthTracker.featuresTitle")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {features.map((f, i) => (
              <FeatureItem key={i} text={f} />
            ))}
          </div>
        </div>
      </section>

      {/* vs Spreadsheet */}
      <section className="py-16 md:py-20 bg-paper-2">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground text-center mb-10">
            {t("lp.netWorthTracker.vsSpreadsheetTitle")}
          </h2>
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-paper-2">
                <tr>
                  <th className="px-6 py-4 text-left font-semibold text-foreground w-1/2"></th>
                  <th className="px-6 py-4 text-center font-semibold text-primary w-1/4">
                    {t("lp.netWorthTracker.vsHeaderApp")}
                  </th>
                  <th className="px-6 py-4 text-center font-semibold text-muted-foreground w-1/4">
                    {t("lp.netWorthTracker.vsHeaderSpreadsheet")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-background">
                {[1, 2, 3, 4, 5].map((n) => (
                  <tr key={n}>
                    <td className="px-6 py-4 text-foreground font-medium">
                      {t(`lp.netWorthTracker.vs${n}Feature`)}
                    </td>
                    <td className="px-6 py-4 text-center text-primary font-medium">
                      {t(`lp.netWorthTracker.vs${n}App`)}
                    </td>
                    <td className="px-6 py-4 text-center text-muted-foreground">
                      {t(`lp.netWorthTracker.vs${n}Spreadsheet`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-8 pb-16 md:pb-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <CTABanner
            headline={t("lp.netWorthTracker.ctaHeadline")}
            description={t("lp.netWorthTracker.ctaBody")}
          />
        </div>
      </section>
    </>
  );
}

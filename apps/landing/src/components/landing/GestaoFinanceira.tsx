import { useTranslations } from "@/lib/reactTranslations";
import AdHero from "@/components/landing/sections/AdHero";
import FeatureHighlights from "@/components/landing/sections/FeatureHighlights";
import HowItWorks from "@/components/landing/sections/HowItWorks";
import CTABanner from "@/components/shared/CTABanner";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

export default function GestaoFinanceira({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <GestaoFinanceiraContent />
    </ReactTranslationsProvider>
  );
}

function GestaoFinanceiraContent() {
  const { t } = useTranslations();

  return (
    <>
      <AdHero
        badge={t("lp.gestaoFinanceira.heroBadge")}
        titleKey="lp.gestaoFinanceira.heroTitle"
        subtitleKey="lp.gestaoFinanceira.heroSubtitle"
      />

      <FeatureHighlights
        titleKey="lp.gestaoFinanceira.featuresTitle"
        items={[
          { titleKey: "lp.gestaoFinanceira.feat1Title", bodyKey: "lp.gestaoFinanceira.feat1Body" },
          { titleKey: "lp.gestaoFinanceira.feat2Title", bodyKey: "lp.gestaoFinanceira.feat2Body" },
          { titleKey: "lp.gestaoFinanceira.feat3Title", bodyKey: "lp.gestaoFinanceira.feat3Body" },
        ]}
      />

      <HowItWorks
        titleKey="lp.gestaoFinanceira.howTitle"
        steps={[
          { titleKey: "lp.gestaoFinanceira.how1Title", bodyKey: "lp.gestaoFinanceira.how1Body" },
          { titleKey: "lp.gestaoFinanceira.how2Title", bodyKey: "lp.gestaoFinanceira.how2Body" },
          { titleKey: "lp.gestaoFinanceira.how3Title", bodyKey: "lp.gestaoFinanceira.how3Body" },
        ]}
      />

      <section className="py-8 pb-16 md:pb-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <CTABanner
            headline={t("lp.gestaoFinanceira.ctaHeadline")}
            description={t("lp.gestaoFinanceira.ctaBody")}
          />
        </div>
      </section>
    </>
  );
}

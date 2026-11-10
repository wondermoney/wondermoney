import { useTranslations } from "@/lib/reactTranslations";
import AdHero from "@/components/landing/sections/AdHero";
import AdTrustBar from "@/components/landing/sections/AdTrustBar";
import DashboardPreview from "@/components/landing/sections/DashboardPreview";
import PainPoints from "@/components/landing/sections/PainPoints";
import FeatureHighlights from "@/components/landing/sections/FeatureHighlights";
import HowItWorks from "@/components/landing/sections/HowItWorks";
import SocialProof from "@/components/landing/sections/SocialProof";
import CTABanner from "@/components/shared/CTABanner";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

export default function ControloGastos({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <ControloGastosContent />
    </ReactTranslationsProvider>
  );
}

function ControloGastosContent() {
  const { t } = useTranslations();

  return (
    <>
      <AdHero
        badge={t("lp.controloGastos.heroBadge")}
        titleKey="lp.controloGastos.heroTitle"
        subtitleKey="lp.controloGastos.heroSubtitle"
      />

      <AdTrustBar />

      <DashboardPreview variant="budget" />

      <PainPoints
        titleKey="lp.controloGastos.painTitle"
        items={[
          { titleKey: "lp.controloGastos.pain1Title", bodyKey: "lp.controloGastos.pain1Body" },
          { titleKey: "lp.controloGastos.pain2Title", bodyKey: "lp.controloGastos.pain2Body" },
          { titleKey: "lp.controloGastos.pain3Title", bodyKey: "lp.controloGastos.pain3Body" },
        ]}
      />

      <FeatureHighlights
        titleKey="lp.controloGastos.featuresTitle"
        items={[
          { titleKey: "lp.controloGastos.feat1Title", bodyKey: "lp.controloGastos.feat1Body" },
          { titleKey: "lp.controloGastos.feat2Title", bodyKey: "lp.controloGastos.feat2Body" },
          { titleKey: "lp.controloGastos.feat3Title", bodyKey: "lp.controloGastos.feat3Body" },
        ]}
      />

      <HowItWorks
        titleKey="lp.controloGastos.howTitle"
        steps={[
          { titleKey: "lp.controloGastos.how1Title", bodyKey: "lp.controloGastos.how1Body" },
          { titleKey: "lp.controloGastos.how2Title", bodyKey: "lp.controloGastos.how2Body" },
          { titleKey: "lp.controloGastos.how3Title", bodyKey: "lp.controloGastos.how3Body" },
        ]}
      />

      <SocialProof />

      <section className="py-8 pb-16 md:pb-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <CTABanner
            headline={t("lp.controloGastos.ctaHeadline")}
            description={t("lp.controloGastos.ctaBody")}
          />
        </div>
      </section>
    </>
  );
}

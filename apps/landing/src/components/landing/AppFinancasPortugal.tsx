import { useTranslations } from "@/lib/reactTranslations";
import AdHero from "@/components/landing/sections/AdHero";
import AdTrustBar from "@/components/landing/sections/AdTrustBar";
import DashboardPreview from "@/components/landing/sections/DashboardPreview";
import FeatureHighlights from "@/components/landing/sections/FeatureHighlights";
import PainPoints from "@/components/landing/sections/PainPoints";
import SocialProof from "@/components/landing/sections/SocialProof";
import CTABanner from "@/components/shared/CTABanner";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

export default function AppFinancasPortugal({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <AppFinancasPortugalContent />
    </ReactTranslationsProvider>
  );
}

function AppFinancasPortugalContent() {
  const { t } = useTranslations();

  return (
    <>
      <AdHero
        badge={t("lp.appFinancasPortugal.heroBadge")}
        titleKey="lp.appFinancasPortugal.heroTitle"
        subtitleKey="lp.appFinancasPortugal.heroSubtitle"
      />

      <AdTrustBar />

      <DashboardPreview variant="accounts" />

      <PainPoints
        titleKey="lp.appFinancasPortugal.painTitle"
        items={[
          { titleKey: "lp.appFinancasPortugal.pain1Title", bodyKey: "lp.appFinancasPortugal.pain1Body" },
          { titleKey: "lp.appFinancasPortugal.pain2Title", bodyKey: "lp.appFinancasPortugal.pain2Body" },
          { titleKey: "lp.appFinancasPortugal.pain3Title", bodyKey: "lp.appFinancasPortugal.pain3Body" },
        ]}
      />

      <FeatureHighlights
        titleKey="lp.appFinancasPortugal.featuresTitle"
        items={[
          { titleKey: "lp.appFinancasPortugal.feat1Title", bodyKey: "lp.appFinancasPortugal.feat1Body" },
          { titleKey: "lp.appFinancasPortugal.feat2Title", bodyKey: "lp.appFinancasPortugal.feat2Body" },
          { titleKey: "lp.appFinancasPortugal.feat3Title", bodyKey: "lp.appFinancasPortugal.feat3Body" },
        ]}
      />

      <SocialProof />

      <section className="py-8 pb-16 md:pb-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <CTABanner
            headline={t("lp.appFinancasPortugal.ctaHeadline")}
            description={t("lp.appFinancasPortugal.ctaBody")}
          />
        </div>
      </section>
    </>
  );
}

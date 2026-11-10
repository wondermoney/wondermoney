import { useTranslations } from "@/lib/reactTranslations";
import AdHero from "@/components/landing/sections/AdHero";
import AdTrustBar from "@/components/landing/sections/AdTrustBar";
import PainPoints from "@/components/landing/sections/PainPoints";
import HowItWorks from "@/components/landing/sections/HowItWorks";
import SocialProof from "@/components/landing/sections/SocialProof";
import CTABanner from "@/components/shared/CTABanner";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { useCtaUrl } from "@/hooks/useCtaUrl";

export default function AdFragmentation({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <AdFragmentationContent />
    </ReactTranslationsProvider>
  );
}

function AdFragmentationContent() {
  const { t } = useTranslations();
  const ctaUrl = useCtaUrl();

  return (
    <>
      <AdHero
        badge={t("lp.adFragmentation.heroBadge")}
        titleKey="lp.adFragmentation.heroTitle"
        subtitleKey="lp.adFragmentation.heroSubtitle"
        ctaLabelKey="lp.shared.ctaCampaignPrimary"
        ctaNoteKey="lp.shared.ctaCampaignNote"
      />

      <AdTrustBar />

      <PainPoints
        titleKey="lp.adFragmentation.painTitle"
        items={[
          { titleKey: "lp.adFragmentation.pain1Title", bodyKey: "lp.adFragmentation.pain1Body" },
          { titleKey: "lp.adFragmentation.pain2Title", bodyKey: "lp.adFragmentation.pain2Body" },
          { titleKey: "lp.adFragmentation.pain3Title", bodyKey: "lp.adFragmentation.pain3Body" },
        ]}
      />

      <HowItWorks
        titleKey="lp.adFragmentation.howTitle"
        steps={[
          { titleKey: "lp.adFragmentation.how1Title", bodyKey: "lp.adFragmentation.how1Body" },
          { titleKey: "lp.adFragmentation.how2Title", bodyKey: "lp.adFragmentation.how2Body" },
          { titleKey: "lp.adFragmentation.how3Title", bodyKey: "lp.adFragmentation.how3Body" },
        ]}
      />

      <SocialProof />

      <section className="py-8 pb-16 md:pb-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <CTABanner
            headline={t("lp.adFragmentation.ctaHeadline")}
            description={t("lp.adFragmentation.ctaBody")}
            ctaText={t("lp.shared.ctaCampaignPrimary")}
            ctaNote={t("lp.shared.ctaCampaignNote")}
            ctaHref={ctaUrl}
          />
        </div>
      </section>
    </>
  );
}

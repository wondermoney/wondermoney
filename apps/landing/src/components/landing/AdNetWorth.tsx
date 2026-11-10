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

export default function AdNetWorth({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <AdNetWorthContent />
    </ReactTranslationsProvider>
  );
}

function AdNetWorthContent() {
  const { t } = useTranslations();
  const ctaUrl = useCtaUrl();

  return (
    <>
      <AdHero
        badge={t("lp.adNetWorth.heroBadge")}
        titleKey="lp.adNetWorth.heroTitle"
        subtitleKey="lp.adNetWorth.heroSubtitle"
        ctaLabelKey="lp.shared.ctaCampaignPrimary"
        ctaNoteKey="lp.shared.ctaCampaignNote"
      />

      <AdTrustBar />

      <PainPoints
        titleKey="lp.adNetWorth.painTitle"
        items={[
          { titleKey: "lp.adNetWorth.pain1Title", bodyKey: "lp.adNetWorth.pain1Body" },
          { titleKey: "lp.adNetWorth.pain2Title", bodyKey: "lp.adNetWorth.pain2Body" },
          { titleKey: "lp.adNetWorth.pain3Title", bodyKey: "lp.adNetWorth.pain3Body" },
        ]}
      />

      <HowItWorks
        titleKey="lp.adNetWorth.howTitle"
        steps={[
          { titleKey: "lp.adNetWorth.how1Title", bodyKey: "lp.adNetWorth.how1Body" },
          { titleKey: "lp.adNetWorth.how2Title", bodyKey: "lp.adNetWorth.how2Body" },
          { titleKey: "lp.adNetWorth.how3Title", bodyKey: "lp.adNetWorth.how3Body" },
        ]}
      />

      <SocialProof />

      <section className="py-8 pb-16 md:pb-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <CTABanner
            headline={t("lp.adNetWorth.ctaHeadline")}
            description={t("lp.adNetWorth.ctaBody")}
            ctaText={t("lp.shared.ctaCampaignPrimary")}
            ctaNote={t("lp.shared.ctaCampaignNote")}
            ctaHref={ctaUrl}
          />
        </div>
      </section>
    </>
  );
}

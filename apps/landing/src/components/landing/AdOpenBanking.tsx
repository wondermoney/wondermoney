import { useTranslations } from "@/lib/reactTranslations";
import { Landmark } from "lucide-react";
import AdHero from "@/components/landing/sections/AdHero";
import ResearchNote from "@/components/landing/sections/ResearchNote";
import AdTrustBar from "@/components/landing/sections/AdTrustBar";
import PainPoints from "@/components/landing/sections/PainPoints";
import HowItWorks from "@/components/landing/sections/HowItWorks";
import SocialProof from "@/components/landing/sections/SocialProof";
import CTABanner from "@/components/shared/CTABanner";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { useCtaUrl } from "@/hooks/useCtaUrl";

export default function AdOpenBanking({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <AdOpenBankingContent />
    </ReactTranslationsProvider>
  );
}

function AdOpenBankingContent() {
  const { t } = useTranslations();
  const ctaUrl = useCtaUrl();

  return (
    <>
      <AdHero
        badge={t("lp.adOpenBanking.heroBadge")}
        titleKey="lp.adOpenBanking.heroTitle"
        subtitleKey="lp.adOpenBanking.heroSubtitle"
        ctaLabelKey="lp.shared.ctaCampaignPrimary"
        ctaNoteKey="lp.shared.ctaCampaignNote"
      />

      <AdTrustBar />

      <PainPoints
        titleKey="lp.adOpenBanking.painTitle"
        items={[
          { titleKey: "lp.adOpenBanking.pain1Title", bodyKey: "lp.adOpenBanking.pain1Body" },
          { titleKey: "lp.adOpenBanking.pain2Title", bodyKey: "lp.adOpenBanking.pain2Body" },
          { titleKey: "lp.adOpenBanking.pain3Title", bodyKey: "lp.adOpenBanking.pain3Body" },
        ]}
      />

      <HowItWorks
        titleKey="lp.adOpenBanking.howTitle"
        steps={[
          { titleKey: "lp.adOpenBanking.how1Title", bodyKey: "lp.adOpenBanking.how1Body" },
          { titleKey: "lp.adOpenBanking.how2Title", bodyKey: "lp.adOpenBanking.how2Body" },
          { titleKey: "lp.adOpenBanking.how3Title", bodyKey: "lp.adOpenBanking.how3Body" },
        ]}
      />

      {/*
        The page argues open banking is a right most people don't know they
        have. The obvious next objection is "then why has nobody I know done
        it?" — which is a question about scale, so it takes a cited number
        rather than more product copy.
      */}
      <section className="py-4">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <ResearchNote
            icon={Landmark}
            noteKey="lp.shared.openBankingScaleNote"
            sourceKey="lp.shared.openBankingScaleSource"
          />
        </div>
      </section>

      <SocialProof />

      <section className="py-8 pb-16 md:pb-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <CTABanner
            headline={t("lp.adOpenBanking.ctaHeadline")}
            description={t("lp.adOpenBanking.ctaBody")}
            ctaText={t("lp.shared.ctaCampaignPrimary")}
            ctaNote={t("lp.shared.ctaCampaignNote")}
            ctaHref={ctaUrl}
          />
        </div>
      </section>
    </>
  );
}

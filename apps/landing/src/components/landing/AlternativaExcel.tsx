import { useTranslations } from "@/lib/reactTranslations";
import AdHero from "@/components/landing/sections/AdHero";
import AdTrustBar from "@/components/landing/sections/AdTrustBar";
import DashboardPreview from "@/components/landing/sections/DashboardPreview";
import PainPoints from "@/components/landing/sections/PainPoints";
import ComparisonTable from "@/components/landing/sections/ComparisonTable";
import FeatureHighlights from "@/components/landing/sections/FeatureHighlights";
import SocialProof from "@/components/landing/sections/SocialProof";
import CTABanner from "@/components/shared/CTABanner";
import TrademarkDisclaimer from "@/components/shared/TrademarkDisclaimer";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

export default function AlternativaExcel({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <AlternativaExcelContent />
    </ReactTranslationsProvider>
  );
}

function AlternativaExcelContent() {
  const { t } = useTranslations();

  return (
    <>
      <AdHero
        badge={t("lp.alternativaExcel.heroBadge")}
        titleKey="lp.alternativaExcel.heroTitle"
        subtitleKey="lp.alternativaExcel.heroSubtitle"
      />

      <AdTrustBar />

      <DashboardPreview variant="comparison" />

      <PainPoints
        titleKey="lp.alternativaExcel.painTitle"
        items={[
          { titleKey: "lp.alternativaExcel.pain1Title", bodyKey: "lp.alternativaExcel.pain1Body" },
          { titleKey: "lp.alternativaExcel.pain2Title", bodyKey: "lp.alternativaExcel.pain2Body" },
          { titleKey: "lp.alternativaExcel.pain3Title", bodyKey: "lp.alternativaExcel.pain3Body" },
        ]}
      />

      <ComparisonTable
        titleKey="lp.alternativaExcel.comparisonTitle"
        subtitleKey="lp.alternativaExcel.comparisonSubtitle"
        competitorName={t("lp.alternativaExcel.excelLabel")}
        featureLabelKey="lp.alternativaExcel.featureLabel"
        rows={[
          { featureKey: "lp.alternativaExcel.row1Feature", competitorKey: "lp.alternativaExcel.row1Excel", wmKey: "lp.alternativaExcel.row1Wm", wmHighlight: true, wmStatus: "check" },
          { featureKey: "lp.alternativaExcel.row2Feature", competitorKey: "lp.alternativaExcel.row2Excel", wmKey: "lp.alternativaExcel.row2Wm", wmHighlight: true, wmStatus: "check" },
          { featureKey: "lp.alternativaExcel.row3Feature", competitorKey: "lp.alternativaExcel.row3Excel", wmKey: "lp.alternativaExcel.row3Wm", wmHighlight: true },
          { featureKey: "lp.alternativaExcel.row4Feature", competitorKey: "lp.alternativaExcel.row4Excel", wmKey: "lp.alternativaExcel.row4Wm", wmHighlight: true, wmStatus: "check" },
          { featureKey: "lp.alternativaExcel.row5Feature", competitorKey: "lp.alternativaExcel.row5Excel", wmKey: "lp.alternativaExcel.row5Wm", wmHighlight: true, wmStatus: "check" },
          { featureKey: "lp.alternativaExcel.row6Feature", competitorKey: "lp.alternativaExcel.row6Excel", wmKey: "lp.alternativaExcel.row6Wm", wmHighlight: true, wmStatus: "check" },
          { featureKey: "lp.alternativaExcel.row7Feature", competitorKey: "lp.alternativaExcel.row7Excel", wmKey: "lp.alternativaExcel.row7Wm", wmHighlight: true, wmStatus: "check" },
        ]}
      />

      <FeatureHighlights
        titleKey="lp.alternativaExcel.featuresTitle"
        items={[
          { titleKey: "lp.alternativaExcel.feat1Title", bodyKey: "lp.alternativaExcel.feat1Body" },
          { titleKey: "lp.alternativaExcel.feat2Title", bodyKey: "lp.alternativaExcel.feat2Body" },
          { titleKey: "lp.alternativaExcel.feat3Title", bodyKey: "lp.alternativaExcel.feat3Body" },
        ]}
      />

      <SocialProof />

      <section className="py-8 pb-16 md:pb-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <CTABanner
            headline={t("lp.alternativaExcel.ctaHeadline")}
            description={t("lp.alternativaExcel.ctaBody2")}
          />
          <div className="mt-8 space-y-2">
            <TrademarkDisclaimer textKey="lp.trademarks.tmExcel" />
            <TrademarkDisclaimer textKey="lp.trademarks.tmGoogleSheets" />
          </div>
        </div>
      </section>
    </>
  );
}

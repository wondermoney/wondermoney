import { useTranslations } from "@/lib/reactTranslations";
import { Button } from "@/components/ui/button";
import CTABanner from "@/components/shared/CTABanner";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { CTA_URL } from "@/hooks/useCtaUrl";

function AssetRow({ category, items }: { category: string; items: string }) {
  return (
    <div className="flex gap-4 py-3 border-b border-border last:border-0">
      <div className="w-40 shrink-0 text-sm font-medium text-foreground">
        {category}
      </div>
      <div className="text-sm text-muted-foreground">{items}</div>
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

export default function HowToCalculateNetWorth({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <HowToCalculateNetWorthContent />
    </ReactTranslationsProvider>
  );
}

function HowToCalculateNetWorthContent() {
  const { t } = useTranslations();

  return (
    <>
      {/* Hero */}
      <section className="bg-background py-12 md:py-16">
        <div className="mx-auto max-w-3xl px-6 text-center lg:px-8">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl text-balance">
            {t("lp.howToCalculateNetWorth.heroTitle")}
          </h1>
          <p className="mt-4 text-lg leading-8 text-muted-foreground max-w-2xl mx-auto">
            {t("lp.howToCalculateNetWorth.heroSubtitle")}
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-6 lg:px-8 py-12">
        {/* What Is Net Worth */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("lp.howToCalculateNetWorth.whatTitle")}
          </h2>
          <p className="text-muted-foreground leading-7 mb-6">
            {t("lp.howToCalculateNetWorth.whatBody")}
          </p>
          <div className="rounded-card bg-primary/10 border border-border px-8 py-5 text-center">
            <p className="text-primary font-semibold text-lg">
              {t("lp.howToCalculateNetWorth.formulaLabel")}
            </p>
          </div>
        </section>

        {/* Why It Matters */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("lp.howToCalculateNetWorth.whyTitle")}
          </h2>
          <p className="max-w-[60ch] text-muted-foreground leading-7">
            {t("lp.howToCalculateNetWorth.whyBody")}
          </p>
        </section>

        {/* Step 1: Assets */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("lp.howToCalculateNetWorth.assetsTitle")}
          </h2>
          <p className="text-muted-foreground leading-7 mb-6">
            {t("lp.howToCalculateNetWorth.assetsBody")}
          </p>
          <div className="rounded-card border border-border overflow-hidden">
            <AssetRow
              category={t("lp.howToCalculateNetWorth.assetCategory1")}
              items={t("lp.howToCalculateNetWorth.assetCategory1Items")}
            />
            <AssetRow
              category={t("lp.howToCalculateNetWorth.assetCategory2")}
              items={t("lp.howToCalculateNetWorth.assetCategory2Items")}
            />
            <AssetRow
              category={t("lp.howToCalculateNetWorth.assetCategory3")}
              items={t("lp.howToCalculateNetWorth.assetCategory3Items")}
            />
            <AssetRow
              category={t("lp.howToCalculateNetWorth.assetCategory4")}
              items={t("lp.howToCalculateNetWorth.assetCategory4Items")}
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground italic">
            {t("lp.howToCalculateNetWorth.assetNote")}
          </p>
        </section>

        {/* Step 2: Liabilities */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("lp.howToCalculateNetWorth.liabilitiesTitle")}
          </h2>
          <p className="text-muted-foreground leading-7 mb-6">
            {t("lp.howToCalculateNetWorth.liabilitiesBody")}
          </p>
          <div className="rounded-card border border-border overflow-hidden">
            <AssetRow
              category={t("lp.howToCalculateNetWorth.liabilityCategory1")}
              items={t("lp.howToCalculateNetWorth.liabilityCategory1Items")}
            />
            <AssetRow
              category={t("lp.howToCalculateNetWorth.liabilityCategory2")}
              items={t("lp.howToCalculateNetWorth.liabilityCategory2Items")}
            />
            <AssetRow
              category={t("lp.howToCalculateNetWorth.liabilityCategory3")}
              items={t("lp.howToCalculateNetWorth.liabilityCategory3Items")}
            />
            <AssetRow
              category={t("lp.howToCalculateNetWorth.liabilityCategory4")}
              items={t("lp.howToCalculateNetWorth.liabilityCategory4Items")}
            />
          </div>
        </section>

        {/* Step 3: Calculate */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("lp.howToCalculateNetWorth.calculateTitle")}
          </h2>
          <p className="max-w-[60ch] text-muted-foreground leading-7">
            {t("lp.howToCalculateNetWorth.calculateBody")}
          </p>
        </section>

        {/* Example */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-foreground mb-6">
            {t("lp.howToCalculateNetWorth.exampleTitle")}
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            <div className="rounded-card bg-success/5 border border-success/30 p-6">
              <p className="text-sm font-semibold text-success-text mb-4">
                {t("lp.howToCalculateNetWorth.exampleAssetsLabel")}
              </p>
              {[
                t("lp.howToCalculateNetWorth.exampleAsset1"),
                t("lp.howToCalculateNetWorth.exampleAsset2"),
                t("lp.howToCalculateNetWorth.exampleAsset3"),
                t("lp.howToCalculateNetWorth.exampleAsset4"),
              ].map((item, i) => (
                <p
                  key={i}
                  className="text-sm text-foreground py-1 border-b border-success/30 last:border-0"
                >
                  {item}
                </p>
              ))}
              <p className="text-sm font-semibold text-success-text mt-3">
                {t("lp.howToCalculateNetWorth.exampleTotalAssets")}
              </p>
            </div>
            <div className="rounded-card bg-destructive/5 border border-destructive/30 p-6">
              <p className="text-sm font-semibold text-destructive-text mb-4">
                {t("lp.howToCalculateNetWorth.exampleLiabilitiesLabel")}
              </p>
              {[
                t("lp.howToCalculateNetWorth.exampleLiability1"),
                t("lp.howToCalculateNetWorth.exampleLiability2"),
                t("lp.howToCalculateNetWorth.exampleLiability3"),
              ].map((item, i) => (
                <p
                  key={i}
                  className="text-sm text-foreground py-1 border-b border-destructive/30 last:border-0"
                >
                  {item}
                </p>
              ))}
              <p className="text-sm font-semibold text-destructive-text mt-3">
                {t("lp.howToCalculateNetWorth.exampleTotalLiabilities")}
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-card bg-primary text-primary-foreground p-6 text-center">
            <p className="text-lg font-semibold">
              {t("lp.howToCalculateNetWorth.exampleResult")}
            </p>
          </div>
        </section>

        {/* Step 4: Track */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            {t("lp.howToCalculateNetWorth.trackTitle")}
          </h2>
          <p className="max-w-[60ch] text-muted-foreground leading-7">
            {t("lp.howToCalculateNetWorth.trackBody")}
          </p>
        </section>

        {/* Automate with WonderMoney */}
        <section className="mb-12 rounded-card border border-border bg-primary/10 p-8">
          <h2 className="text-xl font-semibold text-foreground mb-3">
            {t("lp.howToCalculateNetWorth.autoTitle")}
          </h2>
          <p className="text-muted-foreground leading-7 mb-5">
            {t("lp.howToCalculateNetWorth.autoBody")}
          </p>
          <Button asChild size="lg">
            <a
              href={CTA_URL}
              onClick={() =>
                pushGtmEvent({
                  event: "cta_click",
                  cta_position: "inline",
                  page_type: getPageType(),
                })
              }
            >
              {t("lp.shared.ctaPrimary")}
            </a>
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("lp.shared.trialNote")}
          </p>
        </section>

        {/* FAQ */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-foreground mb-2">
            {t("lp.howToCalculateNetWorth.faqTitle")}
          </h2>
          <FaqItem
            q={t("lp.howToCalculateNetWorth.faq1Q")}
            a={t("lp.howToCalculateNetWorth.faq1A")}
          />
          <FaqItem
            q={t("lp.howToCalculateNetWorth.faq2Q")}
            a={t("lp.howToCalculateNetWorth.faq2A")}
          />
          <FaqItem
            q={t("lp.howToCalculateNetWorth.faq3Q")}
            a={t("lp.howToCalculateNetWorth.faq3A")}
          />
          <FaqItem
            q={t("lp.howToCalculateNetWorth.faq4Q")}
            a={t("lp.howToCalculateNetWorth.faq4A")}
          />
        </section>
      </div>

      {/* CTA */}
      <section className="py-8 pb-16 md:pb-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <CTABanner
            headline={t("lp.howToCalculateNetWorth.ctaHeadline")}
            description={t("lp.howToCalculateNetWorth.ctaBody")}
          />
        </div>
      </section>
    </>
  );
}

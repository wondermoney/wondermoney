import { useTranslations } from "@/lib/reactTranslations";
import { Button } from "@/components/ui/button";
import CTABanner from "@/components/shared/CTABanner";
import TrademarkDisclaimer from "@/components/shared/TrademarkDisclaimer";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { Check, X } from "lucide-react";
import { CTA_URL } from "@/hooks/useCtaUrl";

function PainCard({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-card border border-border bg-background p-6">
      <X className="mb-3 h-6 w-6 text-destructive-text" aria-hidden="true" />
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

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

type ComparisonRow = {
  feature: string;
  ynab: string;
  wm: string;
  wmHighlight?: boolean;
  ynabStatus?: "check" | "cross";
  wmStatus?: "check" | "cross";
};

function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  const { t } = useTranslations();

  return (
    <>
      <div className="hidden md:block overflow-x-auto rounded-card border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-paper-2">
            <tr>
              <th className="px-6 py-4 text-left font-semibold text-foreground w-1/2">
                {t("lp.ynabAlternative.featureLabel")}
              </th>
              <th className="px-6 py-4 text-center font-semibold text-muted-foreground w-1/4">
                {t("lp.ynabAlternative.ynabLabel")}
              </th>
              <th className="px-6 py-4 text-center font-semibold text-primary w-1/4">
                {t("lp.ynabAlternative.wmLabel")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {rows.map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-paper-2/50"}>
                <td className="px-6 py-4 text-foreground font-medium">{row.feature}</td>
                <td className="px-6 py-4 text-center text-muted-foreground">
                  <CellValue value={row.ynab} status={row.ynabStatus} muted />
                </td>
                <td className={`px-6 py-4 text-center font-medium ${row.wmHighlight ? "text-primary" : "text-foreground"}`}>
                  <CellValue value={row.wm} status={row.wmStatus} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="md:hidden divide-y divide-border overflow-hidden rounded-card border border-border bg-background">
        {rows.map((row, i) => (
          <div key={i} className="p-4">
            <p className="text-sm font-semibold text-foreground">{row.feature}</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-paper-2 p-3">
                <p className="text-[11px] font-semibold text-muted-foreground">
                  {t("lp.ynabAlternative.ynabLabel")}
                </p>
                <div className="mt-1 text-sm text-muted-foreground">
                  <CellValue value={row.ynab} status={row.ynabStatus} muted />
                </div>
              </div>
              <div className={`rounded-lg p-3 ${row.wmHighlight ? "bg-primary/10" : "bg-paper-2"}`}>
                <p className="text-[11px] font-semibold text-primary">
                  {t("lp.ynabAlternative.wmLabel")}
                </p>
                <div
                  className={`mt-1 text-sm font-medium ${row.wmHighlight ? "text-primary" : "text-foreground"}`}
                >
                  <CellValue value={row.wm} status={row.wmStatus} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function CellValue({ value, status, muted = false }: { value: string; status?: "check" | "cross"; muted?: boolean }) {
  if (status === "check") {
    return (
      <span className="inline-flex items-center gap-2">
        <Check className="h-4 w-4 flex-none text-success-text" aria-hidden="true" />
        <span>{value}</span>
      </span>
    );
  }
  if (status === "cross") {
    return (
      <span className={`inline-flex items-center gap-2 ${muted ? "text-muted-foreground" : ""}`}>
        <X className="h-4 w-4 flex-none text-destructive-text" aria-hidden="true" />
        <span>{value}</span>
      </span>
    );
  }
  return <>{value}</>;
}

export default function YnabAlternative({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <YnabAlternativeContent />
    </ReactTranslationsProvider>
  );
}

function YnabAlternativeContent() {
  const { t } = useTranslations();

  const comparisonRows: ComparisonRow[] = [
    { feature: t("lp.ynabAlternative.row1Feature"), ynab: t("lp.ynabAlternative.row1Ynab"), wm: t("lp.ynabAlternative.row1Wm"), wmHighlight: true, wmStatus: "check" },
    { feature: t("lp.ynabAlternative.row2Feature"), ynab: t("lp.ynabAlternative.row2Ynab"), wm: t("lp.ynabAlternative.row2Wm"), wmHighlight: true, wmStatus: "check" },
    { feature: t("lp.ynabAlternative.row3Feature"), ynab: t("lp.ynabAlternative.row3Ynab"), wm: t("lp.ynabAlternative.row3Wm"), wmHighlight: true, ynabStatus: "cross", wmStatus: "check" },
    { feature: t("lp.ynabAlternative.row4Feature"), ynab: t("lp.ynabAlternative.row4Ynab"), wm: t("lp.ynabAlternative.row4Wm"), wmHighlight: true, ynabStatus: "cross" },
    { feature: t("lp.ynabAlternative.row5Feature"), ynab: t("lp.ynabAlternative.row5Ynab"), wm: t("lp.ynabAlternative.row5Wm"), ynabStatus: "check", wmStatus: "check" },
    { feature: t("lp.ynabAlternative.row6Feature"), ynab: t("lp.ynabAlternative.row6Ynab"), wm: t("lp.ynabAlternative.row6Wm"), wmHighlight: true, wmStatus: "check" },
    { feature: t("lp.ynabAlternative.row7Feature"), ynab: t("lp.ynabAlternative.row7Ynab"), wm: t("lp.ynabAlternative.row7Wm"), wmHighlight: true },
  ];

  return (
    <>
      {/* Hero */}
      <section className="bg-background py-16 md:py-24">
        <div className="mx-auto max-w-4xl px-6 text-center lg:px-8">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl [text-wrap:balance]">
            <span className="mb-3 block text-xl tracking-normal text-foreground">{t("lp.ynabAlternative.eyebrow")}</span>{" "}
            {t("lp.ynabAlternative.heroTitle")}
          </h1>
          <p className="mt-5 text-lg leading-8 text-muted-foreground max-w-2xl mx-auto">
            {t("lp.ynabAlternative.heroSubtitle")}
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

      {/* Pain Points */}
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center mb-12">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              {t("lp.ynabAlternative.painTitle")}
            </h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            <PainCard
              title={t("lp.ynabAlternative.pain1Title")}
              body={t("lp.ynabAlternative.pain1Body")}
            />
            <PainCard
              title={t("lp.ynabAlternative.pain2Title")}
              body={t("lp.ynabAlternative.pain2Body")}
            />
            <PainCard
              title={t("lp.ynabAlternative.pain3Title")}
              body={t("lp.ynabAlternative.pain3Body")}
            />
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="py-16 md:py-20 bg-paper-2">
        <div className="mx-auto max-w-4xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center mb-10">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              {t("lp.ynabAlternative.comparisonTitle")}
            </h2>
            <p className="mt-3 text-muted-foreground">
              {t("lp.ynabAlternative.comparisonSubtitle")}
            </p>
          </div>
          <ComparisonTable rows={comparisonRows} />
        </div>
      </section>

      {/* Why WonderMoney */}
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center mb-12">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              {t("lp.ynabAlternative.whyTitle")}
            </h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            <FeatureCard
              title={t("lp.ynabAlternative.why1Title")}
              body={t("lp.ynabAlternative.why1Body")}
            />
            <FeatureCard
              title={t("lp.ynabAlternative.why2Title")}
              body={t("lp.ynabAlternative.why2Body")}
            />
            <FeatureCard
              title={t("lp.ynabAlternative.why3Title")}
              body={t("lp.ynabAlternative.why3Body")}
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-8 pb-16 md:pb-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <CTABanner
            headline={t("lp.ynabAlternative.ctaHeadline")}
            description={t("lp.ynabAlternative.ctaBody")}
          />
          <div className="mt-8">
            <TrademarkDisclaimer textKey="lp.trademarks.tmYnab" />
          </div>
        </div>
      </section>
    </>
  );
}

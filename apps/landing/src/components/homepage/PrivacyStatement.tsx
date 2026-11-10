import BackgroundPattern from "./BackgroundPattern";
import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { toLocalizedPath } from "@/lib/routes";

const points = ["noTransfers", "revoke", "credentials"] as const;

export default function PrivacyStatement({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <PrivacyStatementContent locale={locale} />
    </ReactTranslationsProvider>
  );
}

// The privacy promise set as a statement, with the three facts behind it.
function PrivacyStatementContent({ locale }: { locale: Lang }) {
  const { t } = useTranslations();

  return (
    <section className="relative isolate border-t border-border bg-paper-2">
      <BackgroundPattern pattern="grid" fade="right" />
      <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
        <h2 className="max-w-4xl text-4xl font-semibold leading-[1.08] tracking-[-0.02em] text-foreground [text-wrap:balance] sm:text-5xl lg:text-[3.25rem]">
          {t("homepage.privacy.title")}
        </h2>
        <ul className="mt-16 grid gap-10 sm:grid-cols-3 sm:gap-10">
          {points.map((point) => (
            <li key={point} className="min-w-0 border-t border-border pt-6">
              <h3 className="text-lg font-semibold text-foreground">
                {t(`homepage.privacy.${point}.title`)}
              </h3>
              <p className="mt-2 text-base leading-7 text-muted-foreground">
                {t(`homepage.privacy.${point}.body`)}
              </p>
            </li>
          ))}
        </ul>
        <a
          href={toLocalizedPath("featurePrivacy", locale)}
          className="mt-12 inline-block rounded-sm text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 transition-colors hover:decoration-primary"
        >
          {t("homepage.privacy.link")}
        </a>
      </div>
    </section>
  );
}

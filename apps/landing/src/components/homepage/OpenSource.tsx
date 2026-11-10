import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { useCtaUrl } from "@/hooks/useCtaUrl";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import { GITHUB_URL, selfHostingDocsUrl } from "@/lib/openSource";

export default function OpenSource({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <OpenSourceContent locale={locale} />
    </ReactTranslationsProvider>
  );
}

const linkClass =
  "rounded-sm text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 transition-colors hover:decoration-primary";

// Two ways to use it: the hosted instance, or your own server.
function OpenSourceContent({ locale }: { locale: Lang }) {
  const { t } = useTranslations();
  const ctaUrl = useCtaUrl();

  return (
    <section className="border-t border-border bg-background">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 py-24 lg:grid-cols-12 lg:gap-10 lg:px-8 lg:py-32">
        <div className="min-w-0 lg:col-span-5">
          <h2 className="text-4xl font-semibold leading-[1.08] tracking-[-0.02em] text-foreground sm:text-5xl lg:text-[3.25rem]">
            {t("homepage.openSource.title")}
          </h2>
          <p className="mt-6 max-w-md text-lg leading-8 text-muted-foreground">
            {t("homepage.openSource.body")}
          </p>
        </div>
        <div className="grid min-w-0 gap-10 sm:grid-cols-2 lg:col-span-6 lg:col-start-7">
          <div className="min-w-0 border-t border-border pt-6">
            <h3 className="text-lg font-semibold text-foreground">
              {t("homepage.openSource.hosted.title")}
            </h3>
            <p className="mt-2 text-base leading-7 text-muted-foreground">
              {t("homepage.openSource.hosted.body")}
            </p>
            <a
              href={ctaUrl}
              className={`mt-4 inline-block ${linkClass}`}
              onClick={() =>
                pushGtmEvent({
                  event: "cta_click",
                  cta_position: "homepage_open_source",
                  page_type: getPageType(),
                })
              }
            >
              {t("homepage.openSource.hosted.link")}
            </a>
          </div>
          <div className="min-w-0 border-t border-border pt-6">
            <h3 className="text-lg font-semibold text-foreground">
              {t("homepage.openSource.selfHosted.title")}
            </h3>
            <p className="mt-2 text-base leading-7 text-muted-foreground">
              {t("homepage.openSource.selfHosted.body")}
            </p>
            <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              <li>
                <a href={selfHostingDocsUrl(locale)} className={linkClass}>
                  {t("homepage.openSource.selfHosted.guide")}
                </a>
              </li>
              <li>
                <a href={GITHUB_URL} className={linkClass}>
                  {t("homepage.openSource.selfHosted.code")}
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

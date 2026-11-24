import { Check, Minus } from "lucide-react";
import { useTranslations } from "next-intl";

import type { SetupChecklistItem } from "@/lib/instance-setup-checklist";

/**
 * What this server has turned on, as the setup page shows it: one row per optional feature with
 * its state, and for one that is off, a link to the docs that explain how to turn it on. Read
 * only: every setting is an environment variable on the server.
 */
export function InstanceSetupChecklist({
  items,
}: {
  readonly items: readonly SetupChecklistItem[];
}) {
  const t = useTranslations("instanceSetup");

  return (
    <section aria-labelledby="instance-setup-features">
      <h2
        id="instance-setup-features"
        className="text-foreground text-base font-semibold"
      >
        {t("features-title")}
      </h2>
      <p className="text-muted-foreground mt-1 text-sm leading-6">
        {t("features-description")}
      </p>
      <ul className="border-border divide-border mt-4 divide-y rounded-lg border">
        {items.map(({ docsHref, feature, on }) => (
          <li
            key={feature}
            className="flex min-h-11 items-center justify-between gap-4 px-4 py-3 text-sm"
          >
            <div className="min-w-0">
              <p className="text-foreground">{t(`feature-${feature}`)}</p>
              {on ? null : (
                <a
                  href={docsHref}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary focus-visible:ring-ring mt-1 inline-block rounded-sm underline underline-offset-2 hover:decoration-2 focus-visible:ring-2 focus-visible:outline-hidden"
                  aria-label={t("set-up-link-label", {
                    feature: t(`feature-${feature}`),
                  })}
                >
                  {t("set-up-link")}
                </a>
              )}
            </div>
            <span
              className={
                on
                  ? "text-success-text flex shrink-0 items-center gap-1"
                  : "text-muted-foreground flex shrink-0 items-center gap-1"
              }
            >
              {on ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Minus className="size-4" aria-hidden="true" />
              )}
              {on ? t("on") : t("off")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

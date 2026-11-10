import { useEffect, useState } from "react";

import { X } from "lucide-react";
import type { Lang } from "@/lib/i18nLocale";
import { useTranslations } from "@/lib/reactTranslations";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import {
  readPivotBannerDismissed,
  writePivotBannerDismissed,
} from "@/lib/pivotBanner";

const FAQ_URL = "https://app.wonder.money/faq";

export default function PivotAnnouncementBanner({
  locale,
}: {
  locale: Lang;
}) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <PivotAnnouncementBannerContent />
    </ReactTranslationsProvider>
  );
}

function PivotAnnouncementBannerContent() {
  const { t } = useTranslations();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(!readPivotBannerDismissed(window.localStorage));
  }, []);

  if (!visible) return null;

  function dismiss(): void {
    writePivotBannerDismissed(window.localStorage);
    setVisible(false);
  }

  return (
    <div className="relative z-30 w-full border-b border-border bg-primary px-4 py-2.5 text-primary-foreground">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-3 gap-y-1 pr-8 text-center text-sm">
        <span>{t("global.pivotBanner.message")}</span>
        <a
          href={FAQ_URL}
          className="font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-primary-foreground"
        >
          {t("global.pivotBanner.linkLabel")}
        </a>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("global.pivotBanner.dismissLabel")}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground focus-visible:outline-primary-foreground"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

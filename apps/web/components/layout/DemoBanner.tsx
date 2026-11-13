"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { useSignupMode } from "@/lib/api/instance/useInstance";
import { useIsDemoProfile } from "@/lib/api/user/useProfile";
import { useSignOut } from "@/lib/auth/useSignOut";
import { instanceConfig } from "@/lib/instance";

const linkClass =
  "ring-offset-background focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md font-medium underline underline-offset-4 hover:decoration-2 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:opacity-50 lg:min-h-0";

/**
 * On every signed-in screen while the account is the shared read-only demo
 * (`profile.demo`): what the data is, and the two ways to keep going with your
 * own, signing up here (only when this server's sign-up is open) or hosting
 * your own. Not dismissible: every write is refused for as long as it applies.
 */
export default function DemoBanner() {
  const t = useTranslations("demo");
  const locale = useLocale();
  const isDemo = useIsDemoProfile();
  const signupMode = useSignupMode();
  const signOut = useSignOut();
  const [leaving, setLeaving] = useState(false);

  if (!isDemo) return null;

  // The auth pages send a signed-in visitor back to the app, so the demo
  // session ends before sign-up opens.
  const signUp = async () => {
    setLeaving(true);
    await signOut("/auth/signup");
  };

  return (
    <section
      aria-label={t("banner-label")}
      className="border-info-text/50 text-info-text border-b px-4 py-2 text-sm lg:px-10"
    >
      <div className="mx-auto flex max-w-[85rem] flex-wrap items-center gap-x-4 gap-y-1">
        <p className="leading-6">{t("banner-message")}</p>
        <div className="flex flex-wrap items-center gap-x-4">
          {signupMode === "open" ? (
            <button
              type="button"
              className={linkClass}
              disabled={leaving}
              aria-busy={leaving || undefined}
              onClick={() => void signUp()}
            >
              {t("banner-sign-up")}
            </button>
          ) : null}
          <a
            href={`${instanceConfig.docsUrl}/${locale}/docs/self-hosting`}
            target="_blank"
            rel="noreferrer"
            className={linkClass}
          >
            {t("banner-self-host")}
          </a>
        </div>
      </div>
    </section>
  );
}

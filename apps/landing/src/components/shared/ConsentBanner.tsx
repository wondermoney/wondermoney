import { useEffect, useRef, useState } from "react";

import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CollapsedConsentButton,
  SavedConsentStatus,
} from "@/components/shared/ConsentBannerStatus";
import { ConsentToggle } from "@/components/shared/ConsentToggle";
import type { Lang } from "@/lib/i18nLocale";
import { getTranslations } from "@/lib/translations";
import {
  createConsentDecision,
  defaultConsentDecision,
  publishConsentDecision,
  readConsentDecision,
  writeConsentDecision,
  type ConsentDecision,
  type ConsentSelection,
} from "@/lib/consent";
import {
  readConsentPreviewState,
  type ConsentPreviewState,
} from "@/lib/consentPreview";
import { applyTrackingConsent } from "@/lib/gtm";
import { applyPostHogConsent } from "@/lib/posthog";

export function ConsentBanner({ locale }: Readonly<{ locale: Lang }>) {
  const t = getTranslations(locale);
  const [state, setState] = useState<ConsentPreviewState>("default");
  const [selection, setSelection] = useState<ConsentSelection>({
    analytics: false,
    ads: false,
  });
  const [decision, setDecision] = useState<ConsentDecision>(
    defaultConsentDecision,
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const customizeRef = useRef<HTMLButtonElement>(null);
  const choicesRef = useRef<HTMLButtonElement>(null);
  const preview = useRef(false);

  useEffect(() => {
    const stored = readConsentDecision(window.localStorage);
    const forcedState = readConsentPreviewState(
      window.location.search,
      import.meta.env.DEV,
    );
    preview.current = forcedState !== null;
    setDecision(stored);
    setSelection({
      analytics: stored.purposes.analytics,
      ads: stored.purposes.ads,
    });
    setState(forcedState ?? (stored.decidedAt > 0 ? "collapsed" : "default"));
    applyTrackingConsent(stored.purposes);
    applyPostHogConsent(stored.purposes);
  }, []);

  useEffect(() => {
    if (state === "customize" || state === "failure")
      headingRef.current?.focus();
    if (state === "saved") choicesRef.current?.focus();
  }, [state]);

  useEffect(() => {
    if (state !== "saved" || preview.current) return;
    const timer = window.setTimeout(() => {
      setState("collapsed");
      requestAnimationFrame(() => choicesRef.current?.focus());
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (state !== "customize" && state !== "failure") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setState("default");
      requestAnimationFrame(() => customizeRef.current?.focus());
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [state]);

  function save(nextSelection: ConsentSelection): void {
    const next = createConsentDecision(nextSelection);
    if (!writeConsentDecision(window.localStorage, next)) {
      setSelection(nextSelection);
      setState("failure");
      return;
    }

    setDecision(next);
    setSelection(nextSelection);
    publishConsentDecision(window, decision, next);
    applyTrackingConsent(next.purposes);
    applyPostHogConsent(next.purposes);
    setState("saved");
  }

  function openChoices(): void {
    setState("customize");
  }

  function returnToDefault(): void {
    setState("default");
    requestAnimationFrame(() => customizeRef.current?.focus());
  }

  const privacyLink = (
    <a
      href="https://docs.wonder.money/about/privacy-policy"
      className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {t("global.consent.privacyLink")}
    </a>
  );

  if (state === "collapsed") {
    return (
      <CollapsedConsentButton
        buttonRef={choicesRef}
        label={t("global.consent.privacyChoices")}
        onOpen={openChoices}
      />
    );
  }

  if (state === "saved") {
    return (
      <SavedConsentStatus
        buttonRef={choicesRef}
        title={t("global.consent.title")}
        savedLabel={t("global.consent.saved")}
        choicesLabel={t("global.consent.privacyChoices")}
        onOpen={openChoices}
      />
    );
  }

  const customizing = state === "customize" || state === "failure";

  return (
    <aside
      className={`fixed z-50 right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-lg md:right-6 md:bottom-6 md:w-96 ${customizing ? "max-h-[calc(100dvh-8rem)]" : "max-h-[70vh]"}`}
      aria-label={t("global.consent.title")}
    >
      {customizing ? (
        <>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <Lock
                className="h-5 w-5 text-muted-foreground"
                aria-hidden="true"
              />
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="text-base font-semibold focus:outline-none"
              >
                {t("global.consent.customizeTitle")}
              </h2>
            </div>
            <Button variant="ghost" size="sm" onClick={returnToDefault}>
              {t("global.consent.back")}
            </Button>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {t("global.consent.description")}
          </p>
          <div className="mt-4 space-y-3">
            <div className="rounded-md border border-border bg-muted p-3">
              <p className="text-sm font-medium">
                {t("global.consent.necessaryTitle")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("global.consent.necessaryDescription")}
              </p>
            </div>
            <ConsentToggle
              checked={selection.analytics}
              label={t("global.consent.analyticsTitle")}
              description={t("global.consent.analyticsDescription")}
              onChange={(analytics) =>
                setSelection({ ...selection, analytics })
              }
            />
            <ConsentToggle
              checked={selection.ads}
              label={t("global.consent.adsTitle")}
              description={t("global.consent.adsDescription")}
              onChange={(ads) => setSelection({ ...selection, ads })}
            />
          </div>
          <div className="mt-4">{privacyLink}</div>
          {state === "failure" && (
            <p
              role="alert"
              className="mt-3 rounded-md border border-border bg-muted p-3 text-sm text-foreground"
            >
              {t("global.consent.saveError")}
            </p>
          )}
          <div className="mt-4 flex flex-col gap-2">
            <Button
              className="min-h-11"
              variant="outline"
              onClick={() => save(selection)}
            >
              {t(
                state === "failure"
                  ? "global.consent.tryAgain"
                  : "global.consent.save",
              )}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-start gap-3">
            <Lock
              className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <div>
              <h2 className="text-base font-semibold">
                {t("global.consent.title")}
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t("global.consent.description")}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Button
                className="min-h-11"
                variant="default"
                onClick={() => save({ analytics: true, ads: true })}
              >
                {t("global.consent.allowAll")}
              </Button>
              <Button
                className="min-h-11"
                variant="outline"
                onClick={() => save({ analytics: false, ads: false })}
              >
                {t("global.consent.necessaryOnly")}
              </Button>
              <Button
                ref={customizeRef}
                className="min-h-11"
                variant="secondary"
                onClick={openChoices}
              >
                {t("global.consent.customize")}
              </Button>
            </div>
            {privacyLink}
          </div>
        </>
      )}
    </aside>
  );
}

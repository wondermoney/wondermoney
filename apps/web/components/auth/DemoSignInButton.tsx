"use client";

import { useTranslations } from "next-intl";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { completeAuthAndRedirect } from "@/lib/auth/complete-auth";
import {
  type DemoSignInFailure,
  demoSignInFailure,
  startDemoSession,
} from "@/lib/auth/demo-sign-in";
import { getSafeNextPath } from "@/lib/auth/safe-next-path";

import { Button } from "../ui/button";

const FAILURE_MESSAGE = {
  failed: "demo.sign-in-failed",
  "rate-limited": "demo.sign-in-rate-limited",
  unavailable: "demo.sign-in-unavailable",
} as const satisfies Record<DemoSignInFailure, string>;

interface DemoSignInButtonProps {
  /**
   * Start the demo as soon as the button appears, as if pressed: the sign-in page's
   * `?demo=1`, which the marketing site's "Try the demo" links to.
   */
  readonly autoStart?: boolean;
  /** Another sign-in on the page is running. */
  readonly disabled?: boolean;
  readonly locale: string;
  /** The `?next=` destination, validated against this origin when the button is pressed. */
  readonly nextParam?: null | string;
}

/**
 * "Try the demo": one click signs in to the shared read-only demo account, then continues
 * like a password sign-in (provisioning through `/v1/auth/callback`, then the app). The
 * sign-in page renders it only when the server reports `features.demo`.
 */
export function DemoSignInButton({
  autoStart = false,
  disabled,
  locale,
  nextParam = null,
}: DemoSignInButtonProps) {
  const t = useTranslations();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<DemoSignInFailure | null>(null);

  const signIn = async () => {
    setPending(true);
    setFailure(null);
    try {
      await startDemoSession();
    } catch (error) {
      setFailure(demoSignInFailure(error));
      setPending(false);
      return;
    }
    const completed = await completeAuthAndRedirect(
      locale,
      {},
      "demo",
      getSafeNextPath(nextParam, window.location.origin),
    );
    // On success the page is navigating away: the button stays busy until it does.
    if (!completed.ok) {
      setFailure("failed");
      setPending(false);
    }
  };

  // At most once per page: a re-render, or strict mode's second effect pass, must not
  // open a second demo session (each one also spends the demo's rate limit). A failure
  // leaves the button, so the visitor retries by pressing it.
  const autoStarted = useRef(false);
  const startOnArrival = useEffectEvent(() => void signIn());
  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    startOnArrival();
  }, [autoStart]);

  return (
    <div className="border-border mt-10 border-t pt-6">
      <p className="text-muted-foreground text-sm leading-6">
        {t("demo.sign-in-hint")}
      </p>
      <Button
        type="button"
        variant="secondary"
        className="mt-4 w-full font-semibold"
        loading={pending}
        // A server without a demo will not grow one on a second click.
        disabled={disabled || pending || failure === "unavailable"}
        onClick={() => void signIn()}
      >
        {t("demo.sign-in")}
      </Button>
      {failure ? (
        <p role="alert" className="text-destructive-text mt-2 text-sm">
          {t(FAILURE_MESSAGE[failure])}
        </p>
      ) : null}
    </div>
  );
}

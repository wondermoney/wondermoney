"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useCallback, useEffect } from "react";
import { useGoogleReCaptcha } from "react-google-recaptcha-v3";
import { type SubmitHandler, useForm } from "react-hook-form";
import { toast } from "sonner";

import type { RecaptchaVerifyResponse } from "@/app/api/recaptcha/route";
import { useConfirmedFeature } from "@/lib/api/instance/useInstance";
import { resolveAuthLocale } from "@/lib/auth/auth-error-redirect";
import { authClient } from "@/lib/auth/client";
import { completeAuthAndRedirect } from "@/lib/auth/complete-auth";
import {
  getSignupCallbackErrorKey,
  getSignupProviderErrorKey,
} from "@/lib/auth/signup-error";
import {
  captureSignupFunnelEvent,
  getSignupFailureCategory,
  SIGNUP_FUNNEL_EVENTS,
} from "@/lib/utils/analytics";
import { SENTRY_CLIENT_ENABLED } from "@/lib/utils/sentry-enabled";
import { getCallbackURL } from "@/lib/utils/url";
import { useHydrated } from "@/lib/utils/useHydrated";

import {
  canBypassRecaptchaClientFailure,
  deriveNameFromEmail,
  isRecaptchaConfigured,
  type SignupFormSchema,
  signupFormSchema,
} from "./signup-form-contract";
import { SignupFormView } from "./SignupFormView";

interface SignupFormProps {
  /** Household invite: rides through signup so the API links the new user into the owner's tenant. */
  inviteToken?: string;
  /** When set, the email is fixed to the invited address and the field is locked. */
  lockedEmail?: string;
}

export default function SignupForm({
  inviteToken,
  lockedEmail,
}: SignupFormProps) {
  const t = useTranslations();
  const form = useForm<SignupFormSchema>({
    resolver: zodResolver(signupFormSchema),
    defaultValues: {
      email: lockedEmail || "",
      inviteToken: inviteToken || undefined,
      password: "",
    },
  });
  const params = useParams();
  const locale = resolveAuthLocale(
    typeof params.locale === "string" ? params.locale : "en",
  );
  const { executeRecaptcha } = useGoogleReCaptcha();
  const posthog = usePostHog();
  const hydrated = useHydrated();
  // Without Google credentials on the API the sign-in call fails with PROVIDER_NOT_FOUND.
  const googleSignIn = useConfirmedFeature((features) => features.googleSignIn);

  useEffect(() => {
    captureSignupFunnelEvent(posthog, SIGNUP_FUNNEL_EVENTS.started, {
      locale,
      method: "email",
    });
  }, [locale, posthog]);

  const searchParams = useSearchParams();
  const forceRecaptchaFailure = searchParams.get("testRecaptcha") === "fail";

  const verifyRecaptcha =
    useCallback(async (): Promise<RecaptchaVerifyResponse> => {
      if (!isRecaptchaConfigured()) {
        return { success: true, action: "not_configured" };
      }

      if (!executeRecaptcha) {
        if (canBypassRecaptchaClientFailure()) {
          return { success: true, action: "non_production_bypass" };
        }

        return { success: false, error: "reCAPTCHA is unavailable" };
      }

      try {
        const token = await executeRecaptcha("signup");
        const response = await fetch("/api/recaptcha", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, forceFailure: forceRecaptchaFailure }),
        });
        const data = (await response.json()) as RecaptchaVerifyResponse;
        return data;
      } catch {
        if (canBypassRecaptchaClientFailure()) {
          return { success: true, action: "non_production_bypass" };
        }

        return { success: false, error: "reCAPTCHA verification failed" };
      }
    }, [executeRecaptcha, forceRecaptchaFailure]);

  const onSubmit: SubmitHandler<SignupFormSchema> = async (values, e) => {
    e?.preventDefault();
    form.clearErrors();
    captureSignupFunnelEvent(posthog, SIGNUP_FUNNEL_EVENTS.submitClicked, {
      locale,
      method: "email",
    });

    const recaptchaResult = await verifyRecaptcha();
    if (!recaptchaResult.success) {
      captureSignupFunnelEvent(posthog, SIGNUP_FUNNEL_EVENTS.submitFailed, {
        failure_category: getSignupFailureCategory("recaptcha"),
        locale,
        method: "email",
      });
      if (SENTRY_CLIENT_ENABLED) {
        void import("@/lib/utils/sentry-client")
          .then(({ captureClientMessage }) => {
            captureClientMessage("reCAPTCHA verification failed on signup", {
              level: "warning",
              tags: { type: "recaptcha_failed", action: "signup" },
              extra: {
                recaptchaScore: recaptchaResult.score,
                recaptchaAction: recaptchaResult.action,
                recaptchaHostname: recaptchaResult.hostname,
                recaptchaErrorCodes: recaptchaResult.errorCodes,
              },
            });
          })
          .catch(() => {});
      }
      toast.error(t("toast-signup-recaptcha-error"), { duration: 9000 });
      return;
    }

    // New signups never have 2FA enabled yet, so signUp.email establishes a
    // full session immediately (unlike signIn.email, which can pause on a
    // twoFactorRedirect) — provisioning can run right away.
    const { data, error } = await authClient.signUp.email({
      email: values.email,
      password: values.password,
      name: deriveNameFromEmail(values.email),
    });

    if (error || !data?.user) {
      captureSignupFunnelEvent(posthog, SIGNUP_FUNNEL_EVENTS.submitFailed, {
        failure_category: getSignupFailureCategory(error ?? "missing_user"),
        locale,
        method: "email",
      });
      toast.error(t(getSignupProviderErrorKey(error)));
      return;
    }

    const completed = await completeAuthAndRedirect(
      locale,
      { inviteToken: values.inviteToken || undefined, locale },
      "signup_form",
    );

    if (!completed.ok) {
      captureSignupFunnelEvent(posthog, SIGNUP_FUNNEL_EVENTS.submitFailed, {
        failure_category: getSignupFailureCategory("app_callback"),
        locale,
        method: "email",
      });
      toast.error(
        t(
          getSignupCallbackErrorKey(completed.error, {
            hasInvite: Boolean(values.inviteToken),
          }),
        ),
      );
    }
  };

  const signUpWithGoogle = async () => {
    const { error } = await authClient.signIn.social({
      provider: "google",
      callbackURL: getCallbackURL(locale),
    });
    if (error) {
      toast.error(t("toast-signup-error"));
    }
  };

  return (
    <SignupFormView
      form={form}
      hideGoogle={Boolean(inviteToken) || !googleSignIn}
      hydrated={hydrated}
      lockedEmail={lockedEmail}
      onGoogleSignup={signUpWithGoogle}
      onSubmit={onSubmit}
    />
  );
}

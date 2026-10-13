"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Text } from "@/components/ui/Typography";
import useCompleteMfaReenrollment from "@/lib/api/user/useCompleteMfaReenrollment";
import useUserData from "@/lib/api/user/useUserData";
import { buildLocalizedLoginPath } from "@/lib/auth/auth-error-redirect";
import { signOut } from "@/lib/auth/client";
import { useUser } from "@/lib/auth/user-context";

import { useTwoFactorEnrollmentFlow } from "./useTwoFactorEnrollmentFlow";

// Non-dismissible gate shown to users flagged during the Supabase ->
// better-auth migration as previously-MFA-enrolled (their TOTP secret
// wasn't migrated). They must re-enroll before they can use the app.
// The dialog has no close button, ignores Escape/backdrop-click dismissal
// (`hideClose` + prevented outside/escape events + an `onOpenChange` that
// never actually closes), and Radix's modal focus trap + overlay make the
// rest of the app uninteractable behind it. It only ever closes because
// `open` itself flips to `false`, once the server confirms
// `requiresMfaReenrollment` is cleared.
export default function MfaReenrollmentGate() {
  const t = useTranslations();
  const locale = useLocale();
  const user = useUser();
  const userId = user?.id;

  // Safety valve: better-auth's twoFactor.enable requires a password, so an
  // OAuth-only (password-less) account that got flagged can't complete
  // enrollment. Signing out (leaving the app, not bypassing into it) keeps the
  // gate non-dismissible while giving such a user a recovery path / support route.
  const handleSignOut = async () => {
    await signOut().catch(() => undefined);
    window.location.href = buildLocalizedLoginPath(locale);
  };
  // Deliberately fail-soft on a `GET /v1/user/:userId` error: the API still
  // enforces auth server-side and 2FA isn't yet server-enforced, so we don't
  // need a hard block here. React Query's default retry (see
  // lib/query/query-client.ts — up to 2 retries on non-401 errors) is left
  // enabled so a transient failure recovers on its own rather than
  // permanently suppressing the gate for a genuinely-flagged user.
  const { data: userData } = useUserData(userId, { enabled: !!userId });
  const completeMfaReenrollment = useCompleteMfaReenrollment();

  // Tracks whether `verifyTotp` has already succeeded (2FA is enabled) so
  // that a failure clearing `requiresMfaReenrollment` afterwards doesn't
  // fall back to the TOTP step — the code has already been consumed and
  // re-verifying it would just produce a misleading "invalid code" error.
  const [totpVerified, setTotpVerified] = useState(false);

  const { stepDescription, footer, content } = useTwoFactorEnrollmentFlow({
    onEnrolled: () => setTotpVerified(true),
  });

  const clearReenrollmentFlag = () => {
    if (!userId) return;
    completeMfaReenrollment.mutate(userId, {
      onError: () => toast.error(t("toast-mfa-reenrollment-complete-error")),
    });
  };

  useEffect(() => {
    if (!totpVerified) return;
    clearReenrollmentFlag();
    // Only re-run when verification first succeeds; retries are triggered
    // manually via the Retry button below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totpVerified]);

  if (userData?.requiresMfaReenrollment !== true) {
    return null;
  }

  return (
    <Dialog open modal onOpenChange={() => {}}>
      <DialogContent
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("mfa-reenrollment-required-title")}</DialogTitle>
          <DialogDescription>
            {t("mfa-reenrollment-required-body")}
          </DialogDescription>
        </DialogHeader>
        {totpVerified ? (
          <>
            <Text className="text-muted-foreground text-sm">
              {completeMfaReenrollment.isError
                ? t("toast-mfa-reenrollment-complete-error")
                : t("mfa-reenrollment-finalizing")}
            </Text>
            {completeMfaReenrollment.isError && (
              <DialogFooter>
                <Button
                  type="button"
                  onClick={clearReenrollmentFlag}
                  loading={completeMfaReenrollment.isPending}
                  disabled={completeMfaReenrollment.isPending}
                >
                  {t("retry")}
                </Button>
              </DialogFooter>
            )}
          </>
        ) : (
          <>
            <Text className="text-muted-foreground text-sm">
              {stepDescription}
            </Text>
            {content}
            <DialogFooter>{footer}</DialogFooter>
          </>
        )}
        <button
          type="button"
          onClick={handleSignOut}
          className="text-muted-foreground hover:text-foreground mt-2 self-center text-xs underline"
        >
          {t("logout")}
        </button>
      </DialogContent>
    </Dialog>
  );
}

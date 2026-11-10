"use client";

import { MailCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription } from "@/components/ui/Alert";
import { Button } from "@/components/ui/button";
import { useResendVerificationEmail } from "@/lib/auth/useResendVerificationEmail";

/**
 * Shown where an AI feature answered `email_verification_required`: the
 * account has to follow its verification link first. Offers to resend it.
 */
export default function EmailVerificationNotice() {
  const t = useTranslations("emailVerification");
  const { email, resend, state } = useResendVerificationEmail();

  return (
    <Alert variant="info" data-testid="email-verification-notice">
      <MailCheck className="size-4" />
      <AlertDescription className="space-y-3">
        <p>{email ? t("message", { email }) : t("messageNoEmail")}</p>
        {state === "sent" ? (
          <p role="status">{t("sent")}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={state === "sending"}
              onClick={() => void resend()}
            >
              {t("resend")}
            </Button>
            {state === "failed" ? <span role="alert">{t("failed")}</span> : null}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Text } from "@/components/ui/Typography";
import { authClient } from "@/lib/auth/client";

const passwordFormSchema = z.object({
  password: z.string().min(1),
});
type PasswordFormSchemaType = z.infer<typeof passwordFormSchema>;

const makeOtpFormSchema = (lengthError: string) =>
  z.object({ pin: z.string().min(6, { message: lengthError }) });
type OtpFormSchemaType = z.infer<ReturnType<typeof makeOtpFormSchema>>;

export type TwoFactorEnrollmentStep = "password" | "setup" | "verify";

export interface UseTwoFactorEnrollmentFlowOptions {
  // Called after a successful `verifyTotp`. Callers decide what "done" means
  // (e.g. close the dialog).
  onEnrolled?: () => void;
}

// Shared TOTP enrollment flow: enter password -> authClient.twoFactor.enable
// -> show QR + backup codes -> authClient.twoFactor.verifyTotp.
//
// Enrollment is a 3-step flow because better-auth splits it across two
// endpoints: `twoFactor.enable({password})` (requires the account password
// and returns the TOTP URI + backup codes) and `twoFactor.verifyTotp({code})`
// (confirms the user actually set up their authenticator app).
export function useTwoFactorEnrollmentFlow({
  onEnrolled,
}: UseTwoFactorEnrollmentFlowOptions = {}) {
  const t = useTranslations();
  const [step, setStep] = useState<TwoFactorEnrollmentStep>("password");
  const [totpURI, setTotpURI] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const passwordForm = useForm({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { password: "" },
  });
  const otpFormSchema = useMemo(
    () => makeOtpFormSchema(t("otp-length-error")),
    [t],
  );
  const otpForm = useForm({
    resolver: zodResolver(otpFormSchema),
    defaultValues: { pin: "" },
  });

  const reset = () => {
    setStep("password");
    setTotpURI(null);
    setBackupCodes(null);
    passwordForm.reset({ password: "" });
    otpForm.reset({ pin: "" });
  };

  const onSubmitPassword = async ({ password }: PasswordFormSchemaType) => {
    const { data, error } = await authClient.twoFactor.enable({ password });
    if (error || !data) {
      passwordForm.setError("password", { message: t("invalid-password") });
      passwordForm.setFocus("password");
      toast.error(t("toast-enable-2fa-error"));
      return;
    }

    if (data.method === 'totp') {
      setTotpURI(data.totpURI);
      setBackupCodes(data.backupCodes);
    }
    setStep("setup");
  };

  const onCopyBackupCodes = async () => {
    if (!backupCodes) return;
    await navigator.clipboard.writeText(backupCodes.join("\n"));
    toast.success(t("backup-codes-copied"));
  };

  const onSubmitOtp = async ({ pin }: OtpFormSchemaType) => {
    const { error } = await authClient.twoFactor.verifyTotp({ code: pin });
    if (error) {
      otpForm.setError("pin", { message: t("toast-mfa-error") });
      otpForm.setFocus("pin");
      otpForm.resetField("pin");
      return;
    }

    toast.success(t("toast-enable-2fa-success"));
    onEnrolled?.();
  };

  const title = t("enable-2fa");
  // Each step describes what is on screen: the QR code is on the setup step, so the scan
  // instruction belongs there; the verify step only asks for the code.
  const stepDescription =
    step === "password"
      ? t("enter-password-to-continue")
      : step === "setup"
        ? t("scan-qr-code-using-mfa-app")
        : t("2fa-verify-description");

  // Each footer button has its own key so React mounts a new <button> per step. Reusing the
  // DOM node would flip Continue (type="button") into the verify form's submit button while
  // its click is still being handled, and the browser would then submit the empty code.
  const footer =
    step === "password" ? (
      <Button
        key="password-submit"
        type="submit"
        form="2fa-password-form"
        loading={passwordForm.formState.isSubmitting}
        disabled={passwordForm.formState.isSubmitting}
      >
        {t("submit")}
      </Button>
    ) : step === "setup" ? (
      <Button key="setup-continue" type="button" onClick={() => setStep("verify")}>
        {t("continue")}
      </Button>
    ) : (
      <Button
        key="verify-submit"
        type="submit"
        form="2fa-verify-form"
        loading={otpForm.formState.isSubmitting}
        disabled={otpForm.formState.isSubmitting}
      >
        {t("submit")}
      </Button>
    );

  const content = (
    <>
      {step === "password" && (
        <Form {...passwordForm}>
          <form method="post"
            onSubmit={passwordForm.handleSubmit(onSubmitPassword)}
            className="space-y-6"
            id="2fa-password-form"
          >
            <FormField
              control={passwordForm.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("password")}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={t("password")}
                      autoComplete="current-password"
                      autoFocus
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      )}

      {step === "setup" && totpURI && (
        <div className="flex flex-col items-center gap-4">
          <div className="rounded bg-white p-3">
            <QRCodeSVG value={totpURI} size={220} />
          </div>
          {backupCodes && (
            <div className="w-full space-y-2">
              <Text className="font-semibold">{t("backup-codes-title")}</Text>
              <Text className="text-muted-foreground text-sm">
                {t("backup-codes-description")}
              </Text>
              <ul className="grid grid-cols-2 gap-1 rounded border p-3 font-mono text-sm">
                {backupCodes.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={onCopyBackupCodes}
              >
                {t("copy-backup-codes")}
              </Button>
            </div>
          )}
        </div>
      )}

      {step === "verify" && (
        <Form {...otpForm}>
          <form method="post"
            onSubmit={otpForm.handleSubmit(onSubmitOtp)}
            className="w-2/3 space-y-6"
            id="2fa-verify-form"
          >
            <FormField
              control={otpForm.control}
              name="pin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-center font-semibold">
                    {t("enter-code-from-authenticator-app")}
                  </FormLabel>
                  <FormControl>
                    <InputOTP
                      {...field}
                      maxLength={6}
                      autoFocus
                      containerClassName="justify-center"
                      autoComplete="one-time-code"
                      onComplete={() => {
                        otpForm.handleSubmit(onSubmitOtp)();
                      }}
                    >
                      <InputOTPGroup>
                        <InputOTPSlot index={0} />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                        <InputOTPSlot index={5} />
                      </InputOTPGroup>
                    </InputOTP>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      )}
    </>
  );

  return { step, title, stepDescription, footer, content, reset };
}

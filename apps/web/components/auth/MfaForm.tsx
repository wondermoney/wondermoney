"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { authClient } from "@/lib/auth/client";
import { completeAuthAndRedirect } from "@/lib/auth/complete-auth";
import {
  getSecondFactorErrorKey,
  normalizeBackupCode,
  type SecondFactorMethod,
} from "@/lib/auth/second-factor";

import { Button } from "../ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/Form";
import { Input } from "../ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "../ui/input-otp";

const makeTotpSchema = (lengthError: string) =>
  z.object({ pin: z.string().min(6, { message: lengthError }) });

const makeBackupCodeSchema = (requiredError: string) =>
  z.object({ code: z.string().trim().min(1, { message: requiredError }) });

/**
 * A full session now exists: run the same provisioning and redirect as
 * LoginForm's non-2FA path (provisioning is deliberately deferred until after
 * the 2FA challenge, per better-auth's session semantics). `next` rides on this
 * page's own query string (LoginForm and the /auth/complete route put it
 * there); completeAuthAndRedirect re-validates it.
 */
async function finishSignIn(locale: string, failureMessage: string) {
  const completed = await completeAuthAndRedirect(
    locale,
    {},
    "auth_complete",
    new URLSearchParams(window.location.search).get("next"),
  );
  if (!completed.ok) {
    toast.error(failureMessage);
  }
}

export default function MfaForm() {
  const params = useParams();
  const locale = typeof params.locale === "string" ? params.locale : "en";
  const [method, setMethod] = useState<SecondFactorMethod>("totp");

  // Each method is its own form, mounted only while chosen, so switching drops
  // whatever was typed into the other one.
  return (
    <div className="mt-10">
      {method === "totp" ? (
        <TotpForm locale={locale} onUseBackupCode={() => setMethod("backup-code")} />
      ) : (
        <BackupCodeForm locale={locale} onUseAuthenticator={() => setMethod("totp")} />
      )}
    </div>
  );
}

function TotpForm({
  locale,
  onUseBackupCode,
}: {
  locale: string;
  onUseBackupCode: () => void;
}) {
  const t = useTranslations();
  const formSchema = useMemo(() => makeTotpSchema(t("otp-length-error")), [t]);
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { pin: "" },
  });

  const onSubmit = async (values: z.infer<ReturnType<typeof makeTotpSchema>>) => {
    form.clearErrors();

    const { error } = await authClient.twoFactor.verifyTotp({ code: values.pin });
    if (error) {
      // Clear the code first: resetField also clears the field's error unless told to keep it.
      form.resetField("pin", { keepError: true });
      form.setError("pin", { message: t(getSecondFactorErrorKey(error)) });
      form.setFocus("pin");
      return;
    }

    await finishSignIn(locale, t("toast-mfa-error"));
  };

  const submitting = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form method="post" className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="pin"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("enter-code-from-authenticator-app")}</FormLabel>
              <FormControl>
                <InputOTP
                  {...field}
                  maxLength={6}
                  autoFocus
                  autoComplete="one-time-code"
                  onComplete={() => {
                    form.handleSubmit(onSubmit)();
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
        <Button
          type="submit"
          className="w-full font-semibold"
          loading={submitting}
          disabled={submitting}
        >
          {t("submit")}
        </Button>
        <Button
          type="button"
          variant="link"
          className="w-full"
          disabled={submitting}
          onClick={onUseBackupCode}
        >
          {t("mfa-use-backup-code")}
        </Button>
      </form>
    </Form>
  );
}

/**
 * Signs in with one of the backup codes shown when two-factor was turned on.
 * The code is never logged or stored: it lives in this form's state until it
 * is sent, and a refused code is cleared from the field.
 */
function BackupCodeForm({
  locale,
  onUseAuthenticator,
}: {
  locale: string;
  onUseAuthenticator: () => void;
}) {
  const t = useTranslations();
  const formSchema = useMemo(
    () => makeBackupCodeSchema(t("mfa-backup-code-required")),
    [t],
  );
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { code: "" },
  });

  const onSubmit = async (values: z.infer<ReturnType<typeof makeBackupCodeSchema>>) => {
    form.clearErrors();

    // No `trustDevice`: as with the authenticator code, every sign-in asks for a second factor.
    const { error } = await authClient.twoFactor.verifyBackupCode({
      code: normalizeBackupCode(values.code),
    });
    if (error) {
      form.resetField("code", { keepError: true });
      form.setError("code", { message: t(getSecondFactorErrorKey(error)) });
      form.setFocus("code");
      return;
    }

    await finishSignIn(locale, t("toast-mfa-error"));
  };

  const submitting = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form method="post" className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("mfa-backup-code-label")}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="text"
                  autoFocus
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="font-mono"
                />
              </FormControl>
              <FormDescription>{t("mfa-backup-code-description")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          className="w-full font-semibold"
          loading={submitting}
          disabled={submitting}
        >
          {t("submit")}
        </Button>
        <Button
          type="button"
          variant="link"
          className="w-full"
          disabled={submitting}
          onClick={onUseAuthenticator}
        >
          {t("mfa-use-authenticator-code")}
        </Button>
      </form>
    </Form>
  );
}

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { authClient } from "@/lib/auth/client";
import { completeAuthAndRedirect } from "@/lib/auth/complete-auth";

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
import { InputOTP, InputOTPGroup, InputOTPSlot } from "../ui/input-otp";

const makeFormSchema = (lengthError: string) =>
  z.object({ pin: z.string().min(6, { message: lengthError }) });

export default function MfaForm() {
  const t = useTranslations();
  const params = useParams();
  const locale = typeof params.locale === "string" ? params.locale : "en";
  const formSchema = useMemo(
    () => makeFormSchema(t("otp-length-error")),
    [t],
  );
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { pin: "" },
  });

  const onSubmit = async (values: z.infer<ReturnType<typeof makeFormSchema>>) => {
    form.clearErrors();

    const { error } = await authClient.twoFactor.verifyTotp({
      code: values.pin,
    });
    if (error) {
      form.setError("pin", { message: t("invalid-code") });
      form.setFocus("pin");
      form.resetField("pin");
      return;
    }

    // A full session now exists — run the same provisioning + redirect as
    // LoginForm's non-2FA path (provisioning is deliberately deferred until
    // after the 2FA challenge, per better-auth's session semantics).
    // `next` rides on this page's own query string (LoginForm and the
    // /auth/complete route put it there); completeAuthAndRedirect re-validates it.
    const completed = await completeAuthAndRedirect(
      locale,
      {},
      "auth_complete",
      new URLSearchParams(window.location.search).get("next"),
    );
    if (!completed.ok) {
      toast.error(t("toast-mfa-error"));
    }
  };

  return (
    <div className="mt-10">
      <Form {...form}>
        <form method="post" className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
          <FormField
            control={form.control}
            name="pin"
            render={({ field }) => (
              <FormItem>
                <FormLabel> {t("enter-code-from-authenticator-app")}</FormLabel>
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
            loading={form.formState.isSubmitting}
            disabled={form.formState.isSubmitting}
          >
            {t("submit")}
          </Button>
        </form>
      </Form>
    </div>
  );
}

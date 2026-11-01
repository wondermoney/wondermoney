"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { SubmitHandler, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Link } from "@/i18n/navigation";
import { useConfirmedFeature } from "@/lib/api/instance/useInstance";
import { authClient } from "@/lib/auth/client";
import { completeAuthAndRedirect } from "@/lib/auth/complete-auth";
import { getSafeNextPath, withNextParam } from "@/lib/auth/safe-next-path";
import { getCallbackURL } from "@/lib/utils/url";

import { Button } from "../ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/Form";
import { Input } from "../ui/input";

const formSchema = z.object({
  email: z.email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type FormSchema = z.infer<typeof formSchema>;

// better-auth's twoFactorClient rewrites a pending-2FA sign-in response to
// `{ twoFactorRedirect: true, twoFactorMethods }` instead of the normal
// `{ redirect, token, user }` shape — not reflected in signIn.email's
// declared return type, since that's a runtime-only plugin behavior.
type SignInEmailResult = {
  readonly twoFactorRedirect?: boolean;
};

interface LoginFormProps {
  nextParam?: string | null;
}

export default function LoginForm({ nextParam }: LoginFormProps = {}) {
  const t = useTranslations();
  // Without Google credentials on the API the sign-in call fails with PROVIDER_NOT_FOUND.
  const googleSignIn = useConfirmedFeature((features) => features.googleSignIn);
  const [isNavigating, setIsNavigating] = useState(false);
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", password: "" },
  });
  const params = useParams();
  const locale = typeof params.locale === "string" ? params.locale : "en";

  const isLoading = form.formState.isSubmitting || isNavigating;

  // Validated where it is used (the browser's origin is only known there); an
  // unsafe value is dropped here rather than carried into MFA or OAuth.
  const getNext = () => getSafeNextPath(nextParam, window.location.origin);

  const onSubmit: SubmitHandler<FormSchema> = async (values, e) => {
    e?.preventDefault();
    form.clearErrors();

    const { data, error: loginError } = await authClient.signIn.email({
      email: values.email,
      password: values.password,
    });

    if (loginError) {
      toast.error(t("toast-login-error"));
      return;
    }

    // A pending 2FA challenge means the credential session better-auth
    // briefly created was deleted server-side — no full session exists yet.
    // Provisioning must wait until MfaForm completes the challenge.
    if ((data as SignInEmailResult | null)?.twoFactorRedirect) {
      setIsNavigating(true);
      // A full page load, not router.push: the MFA page must start from the cookies the
      // server just changed, not from the client-side session state.
      window.location.assign(withNextParam(`/${locale}/auth/mfa`, getNext()));
      return;
    }

    setIsNavigating(true);
    const completed = await completeAuthAndRedirect(
      locale,
      {},
      "auth_complete",
      getNext(),
    );
    if (!completed.ok) {
      setIsNavigating(false);
      toast.error(t("toast-login-error"));
    }
  };

  const signInWithGoogle = async () => {
    const { error } = await authClient.signIn.social({
      provider: "google",
      callbackURL: withNextParam(getCallbackURL(locale), getNext()),
    });
    if (error) {
      toast.error(t("toast-login-error"));
    }
  };

  return (
    <div className="mt-10">
      <Form {...form}>
        <form
          method="post"
          className="space-y-6"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("email")}</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    placeholder={t("email")}
                    required
                    autoComplete="email"
                    autoFocus
                    className="bg-card"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("password")}</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    placeholder={t("password")}
                    required
                    autoComplete="current-password"
                    className="bg-card"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {/* Was muted grey with an underline that only appeared on hover, so
              at rest the one route back into a locked-out account looked
              quieter than body text — and on touch, where there is no hover,
              it never announced itself as a link at all. */}
          <div className="flex items-center justify-end">
            <Link
              href="/auth/forgot"
              className="text-primary text-sm underline underline-offset-2 hover:decoration-2"
            >
              {t("forgot-pw")}
            </Link>
          </div>
          <Button
            type="submit"
            className="w-full font-semibold"
            loading={isLoading}
            disabled={isLoading}
          >
            {t("log-in")}
          </Button>
        </form>
      </Form>

      {googleSignIn && (
        <div className="mt-10">
          <div className="relative">
            <div
              className="absolute inset-0 flex items-center"
              aria-hidden="true"
            >
              <div className="border-border w-full border-t" />
            </div>
            <div className="relative flex justify-center text-sm leading-6 font-medium">
              <span className="bg-muted text-muted-foreground px-6">
                {t("or-continue-with")}
              </span>
            </div>
          </div>

          <div className="mt-6">
            <Button
              variant="secondary"
              className="flex w-full items-center justify-center gap-3"
              onClick={signInWithGoogle}
            >
              <svg className="size-5" aria-hidden="true" viewBox="0 0 24 24">
                <path
                  d="M12.0003 4.75C13.7703 4.75 15.3553 5.36002 16.6053 6.54998L20.0303 3.125C17.9502 1.19 15.2353 0 12.0003 0C7.31028 0 3.25527 2.69 1.28027 6.60998L5.27028 9.70498C6.21525 6.86002 8.87028 4.75 12.0003 4.75Z"
                  fill="#EA4335"
                />
                <path
                  d="M23.49 12.275C23.49 11.49 23.415 10.73 23.3 10H12V14.51H18.47C18.18 15.99 17.34 17.25 16.08 18.1L19.945 21.1C22.2 19.01 23.49 15.92 23.49 12.275Z"
                  fill="#4285F4"
                />
                <path
                  d="M5.26498 14.2949C5.02498 13.5699 4.88501 12.7999 4.88501 11.9999C4.88501 11.1999 5.01998 10.4299 5.26498 9.7049L1.275 6.60986C0.46 8.22986 0 10.0599 0 11.9999C0 13.9399 0.46 15.7699 1.28 17.3899L5.26498 14.2949Z"
                  fill="#FBBC05"
                />
                <path
                  d="M12.0004 24.0001C15.2404 24.0001 17.9654 22.935 19.9454 21.095L16.0804 18.095C15.0054 18.82 13.6204 19.245 12.0004 19.245C8.8704 19.245 6.21537 17.135 5.2654 14.29L1.27539 17.385C3.25539 21.31 7.3104 24.0001 12.0004 24.0001Z"
                  fill="#34A853"
                />
              </svg>
              <span className="text-sm leading-6 font-semibold">
                {t("google")}
              </span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

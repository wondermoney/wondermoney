"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth/client";
import { INVALID_RESET_LINK_REDIRECT } from "@/lib/auth/reset-link";

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

const formSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z
      .string()
      .min(8, "Password must be at least 8 characters"),
  })
  .refine(
    (values) => {
      return values.password === values.confirmPassword;
    },
    { message: "Passwords must match!", path: ["confirmPassword"] },
  );

export default function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations();
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });
  // better-auth's reset-password email link redirects here with either
  // `?token=<valid>` or `?error=INVALID_TOKEN` (see
  // requestPasswordResetCallback in better-auth's password routes).
  const linkError = searchParams.get("error");
  const token = searchParams.get("token");
  const resetToken = linkError || !token ? null : token;

  // The reason travels in the URL and the forgot-password page shows it
  // inline. A toast fired here never appeared: on a fresh load from the email
  // link this effect runs before the app's Toaster has subscribed, so sonner
  // dropped it, and the redirect then took the page away. `replace` so Back
  // does not return to a link that will only bounce again.
  useEffect(() => {
    if (resetToken) return;
    router.replace(INVALID_RESET_LINK_REDIRECT);
  }, [resetToken, router]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    form.clearErrors();
    if (!resetToken) {
      toast.error(t("toast-reset-pw-error"));
      return;
    }
    const { error } = await authClient.resetPassword({
      newPassword: values.password,
      token: resetToken,
    });
    if (error) {
      toast.error(t("toast-reset-pw-error"));
      return;
    }
    toast.success(t("toast-reset-pw-success"));
    window?.setTimeout(() => {
      router.push("/");
    }, 1000);
  };

  return (
    <div className="mt-10">
      <Form {...form}>
        <form method="post" className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("new-password")}</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    placeholder={t("password")}
                    required
                    autoComplete="new-password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("repeat-new-password")}</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    placeholder={t("password")}
                    required
                    autoComplete="new-password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            className="w-full font-semibold"
            loading={form.formState.isSubmitting}
          >
            {t("reset-password")}
          </Button>
        </form>
      </Form>
    </div>
  );
}

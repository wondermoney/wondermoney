"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth/client";

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
  const [resetToken, setResetToken] = useState<string | null>(null);

  useEffect(() => {
    // better-auth's reset-password email link redirects here with either
    // `?token=<valid>` or `?error=INVALID_TOKEN` (see
    // requestPasswordResetCallback in better-auth's password routes).
    const linkError = searchParams.get("error");
    const token = searchParams.get("token");
    if (linkError || !token) {
      toast.error(t("toast-reset-pw-error"));
      router.push("/auth/forgot");
      return;
    }
    setResetToken(token);
  }, [router, searchParams, t]);

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
        <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
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

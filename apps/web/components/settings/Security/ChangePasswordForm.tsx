"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
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
import { authClient } from "@/lib/auth/client";
import { useUser } from "@/lib/auth/user-context";
import { cn } from "@/lib/utils";

const formSchema = z
  .object({
    currentPassword: z.string().min(8),
    newPassword: z.string().min(8),
    confirmNewPassword: z.string().min(8),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "Passwords do not match",
    path: ["confirmNewPassword"],
  });

type Props = {
  className?: string;
};

export default function ChangePasswordForm({ className }: Props) {
  const user = useUser();
  const t = useTranslations();
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmNewPassword: "",
    },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    form.clearErrors();
    if (!user || !user.email) return;

    // better-auth's `changePassword` verifies the current password and
    // rotates the credential in one call. Revoking other sessions on
    // change is the safer default when a password is updated.
    const { error } = await authClient.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
      revokeOtherSessions: true,
    });
    if (error) {
      form.setError("currentPassword", {
        type: "manual",
        message: t("invalid-password"),
      });
      form.setFocus("currentPassword");
      toast.error(t("toast-update-password-info-error"));
      return;
    }

    form.reset({
      currentPassword: "",
      newPassword: "",
      confirmNewPassword: "",
    });
    toast.success(t("toast-update-password-info-success"));
  };

  return (
    <Form {...form}>
      <form method="post"
        className={cn("space-y-6", className)}
        onSubmit={form.handleSubmit(onSubmit)}
      >
        <FormField
          control={form.control}
          name="currentPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t("current-password")}</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  placeholder={t("current-password")}
                  required
                  autoComplete="current-password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="newPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t("new-password")}</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  placeholder={t("new-password")}
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
          name="confirmNewPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t("repeat-new-password")}</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  placeholder={t("new-password")}
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
          disabled={form.formState.isSubmitting}
        >
          {t("save")}
        </Button>
      </form>
    </Form>
  );
}

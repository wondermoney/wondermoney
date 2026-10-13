"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/Typography";
import { authClient } from "@/lib/auth/client";

import TwoFactorAuthEnableDialog from "./2FAEnableDialog";

const disableFormSchema = z.object({
  password: z.string().min(1),
});
type DisableFormSchemaType = z.infer<typeof disableFormSchema>;

// better-auth requires the account password to disable 2FA (the old
// Supabase `mfa.unenroll` call didn't need one). This small dialog collects
// it — everything else (toasts, enabled/disabled UI) is driven by
// `authClient.useSession()` below, which better-auth refreshes automatically
// after any `/two-factor/*` call.
function TwoFactorAuthDisableDialog() {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  const form = useForm({
    resolver: zodResolver(disableFormSchema),
    defaultValues: { password: "" },
  });

  const onOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      form.reset({ password: "" });
    }
  };

  const onSubmit = async ({ password }: DisableFormSchemaType) => {
    const { error } = await authClient.twoFactor.disable({ password });
    if (error) {
      form.setError("password", { message: t("invalid-password") });
      form.setFocus("password");
      form.resetField("password");
      toast.error(t("toast-disable-2fa-error"));
      return;
    }

    setOpen(false);
    toast.success(t("toast-disable-2fa-success"));
  };

  return (
    <DrawerDialog
      title={t("disable-2fa")}
      description={t("enter-password-to-continue")}
      trigger={<Button variant="destructive">{t("disable-2fa")}</Button>}
      footer={
        <Button
          type="submit"
          form="2fa-disable-form"
          variant="destructive"
          loading={form.formState.isSubmitting}
          disabled={form.formState.isSubmitting}
        >
          {t("disable-2fa")}
        </Button>
      }
      open={open}
      onOpenChange={onOpenChange}
    >
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-6"
          id="2fa-disable-form"
        >
          <FormField
            control={form.control}
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
    </DrawerDialog>
  );
}

export default function TwoFactorAuth() {
  const t = useTranslations();
  const { data } = authClient.useSession();
  const hasFactor = data?.user.twoFactorEnabled ?? false;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Text>{t("status")}:</Text>
        <Badge
          className="uppercase"
          variant={hasFactor ? "success" : "destructive"}
        >
          {hasFactor ? t("enabled") : t("disabled")}
        </Badge>
      </div>
      {hasFactor ? (
        <TwoFactorAuthDisableDialog />
      ) : (
        <TwoFactorAuthEnableDialog />
      )}
    </div>
  );
}

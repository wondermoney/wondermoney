"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { authClient } from "@/lib/auth/client";
import { getResetPasswordCallbackURL } from "@/lib/utils/url";

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

const formSchema = z.object({ email: z.string().email("Invalid email") });

export default function ForgotPasswordForm() {
  const t = useTranslations();
  const params = useParams();
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "" },
  });
  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    form.clearErrors();
    const { error } = await authClient.requestPasswordReset({
      email: values.email,
      redirectTo: getResetPasswordCallbackURL(params.locale as string),
    });
    if (error) {
      toast.error(t("toast-reset-pw-error"));
    } else {
      toast.success(t("toast-reset-pw-success"));
    }
  };

  return (
    <div className="mt-10">
      <Form {...form}>
        <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
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
                    className="bg-card"
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

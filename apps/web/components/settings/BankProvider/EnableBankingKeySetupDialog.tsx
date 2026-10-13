"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Alert } from "@/components/ui/Alert";
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
import { Link } from "@/components/ui/Link";
import { Textarea } from "@/components/ui/textarea";
import { Text } from "@/components/ui/Typography";
import {
  type EnableBankingCredentialApiError,
  useSaveEnableBankingCredential,
} from "@/lib/api/user/useEnableBankingCredential";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";

const FORM_ID = "enable-banking-key-setup-form";

const apiMessage = (error: unknown): string | undefined =>
  (error as EnableBankingCredentialApiError)?.response?.data?.message;

const emptyValues = { applicationId: "", privateKeyPem: "" };

interface Props {
  triggerLabel: string;
  isUpdate: boolean;
  /** Optional extra hook for callers — the query itself is already
   * invalidated by the mutation, so most callers don't need this. */
  onSaved?: () => void;
}

/**
 * Setup dialog for the BYOK Enable Banking credential. The "Test & Save"
 * submit round-trips through the API, which performs a live validation call
 * against Enable Banking before persisting anything — so a failure here is
 * routine, not exceptional, and needs to be recoverable in place: shown
 * inline (not toast-and-dismiss) so the user can fix the value and resubmit
 * without losing what they already typed or reopening the dialog.
 *
 * The private key never leaves this form's own React Hook Form state except
 * as the mutation's request body — never logged, never captured, and cleared
 * whenever the dialog closes.
 */
export default function EnableBankingKeySetupDialog({
  triggerLabel,
  isUpdate,
  onSaved,
}: Props) {
  const t = useTranslations("bankProvider");
  const notifyIfRateLimited = useRateLimitToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const schema = z.object({
    applicationId: z
      .string()
      .trim()
      .min(1, { message: t("setup.applicationIdRequired") }),
    privateKeyPem: z
      .string()
      .trim()
      .min(1, { message: t("setup.privateKeyRequired") })
      .refine((value) => value.includes("-----BEGIN"), {
        message: t("setup.privateKeyInvalidFormat"),
      }),
  });
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: emptyValues,
  });

  const saveCredential = useSaveEnableBankingCredential();

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && !saveCredential.isPending) {
      // Drop the private key from memory as soon as the dialog closes.
      setError(null);
      form.reset(emptyValues);
    }
  };

  const onSubmit = form.handleSubmit((values) => {
    setError(null);
    saveCredential.mutate(
      {
        applicationId: values.applicationId,
        privateKeyPem: values.privateKeyPem,
      },
      {
        onSuccess: () => {
          toast.success(t("toastSaveSuccess"));
          form.reset(emptyValues);
          setOpen(false);
          onSaved?.();
        },
        onError: (err) => {
          if (notifyIfRateLimited(err)) return;
          setError(apiMessage(err) ?? t("setup.genericError"));
        },
      },
    );
  });

  return (
    <DrawerDialog
      title={isUpdate ? t("setup.titleUpdate") : t("setup.titleAdd")}
      triggerLabel={triggerLabel}
      open={open}
      onOpenChange={handleOpenChange}
      footer={
        <Button
          type="submit"
          form={FORM_ID}
          loading={saveCredential.isPending}
          disabled={saveCredential.isPending}
        >
          {t("setup.submit")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Text variant="mutedText" className="text-sm">
          {t("setup.intro")}{" "}
          <Link
            href="/faq"
            className="font-medium underline underline-offset-4"
          >
            {t("setup.helpCta")}
          </Link>
        </Text>

        <Form {...form}>
          <form
            id={FORM_ID}
            onSubmit={onSubmit}
            className="flex flex-col gap-4"
          >
            <FormField
              control={form.control}
              name="applicationId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("setup.applicationIdLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t("setup.applicationIdPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="privateKeyPem"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("setup.privateKeyLabel")}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={8}
                      className="font-mono text-xs"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      placeholder={t("setup.privateKeyPlaceholder")}
                    />
                  </FormControl>
                  <Text variant="mutedText" className="text-xs">
                    {t("setup.privateKeyHint")}
                  </Text>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        {error && <Alert variant="destructive">{error}</Alert>}
      </div>
    </DrawerDialog>
  );
}

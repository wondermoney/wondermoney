import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useGoogleReCaptcha } from "react-google-recaptcha-hook";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useTranslations } from "@/lib/reactTranslations";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { sendLeadCaptureEmail, type LeadCaptureSource } from "@/lib/leadCapture";
import { emailCaptureSchema, type EmailCaptureValues } from "@/lib/emailCapture";
import { toLocalizedPath } from "@/lib/routes";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";

export type EmailCaptureVariant = "footer" | "inline";

export type Props = {
  locale: Lang;
  source: LeadCaptureSource;
  variant?: EmailCaptureVariant;
};

export default function EmailCaptureForm({
  locale,
  source,
  variant = "inline",
}: Props) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <EmailCaptureFormContent locale={locale} source={source} variant={variant} />
    </ReactTranslationsProvider>
  );
}

function EmailCaptureFormContent({
  locale,
  source,
  variant,
}: Required<Props>) {
  const { t } = useTranslations();
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isSubmitSuccessful, setIsSubmitSuccessful] = useState(false);
  const { executeGoogleReCaptcha } = useGoogleReCaptcha(
    "6Lf30ZsqAAAAAHC-p0cVK1ZHQMk5626roh2_ViUo",
    { hide: true, enterprise: false },
  );

  const form = useForm<EmailCaptureValues>({
    resolver: zodResolver(emailCaptureSchema),
    defaultValues: {
      email: "",
    },
  });

  const guideHref = toLocalizedPath("guideMoneyCheckin", locale);

  async function onSubmit(values: EmailCaptureValues) {
    setSubmissionError(null);
    setIsSubmitSuccessful(false);

    try {
      if (!executeGoogleReCaptcha) {
        throw new Error(t("emailCapture.form.captchaNotReady"));
      }

      const token = await executeGoogleReCaptcha("email_capture");

      if (!token) {
        throw new Error(t("emailCapture.form.captchaError"));
      }

      await sendLeadCaptureEmail({
        email: values.email,
        captcha: token,
        source,
      });

      form.reset();
      setIsSubmitSuccessful(true);
      pushGtmEvent({
        event: "lead_capture_submit",
        lead_capture_source: source,
        page_type: getPageType(),
      });
    } catch (error) {
      setSubmissionError(
        error instanceof Error ? error.message : t("emailCapture.form.error"),
      );
    }
  }

  const pretitle = t(`emailCapture.${variant}.pretitle`, { defaultValue: "" });
  const title = t(`emailCapture.${variant}.title`);
  const description = t(`emailCapture.${variant}.description`);

  const isFooter = variant === "footer";

  return (
    <div
      className={
        isFooter
          ? "w-full max-w-md"
          : "w-full rounded-card border border-border bg-paper-2 px-6 py-8 sm:px-10 sm:py-10"
      }
    >
      <h3
        className={
          isFooter
            ? "text-sm font-semibold leading-6 text-foreground"
            : "text-2xl font-bold tracking-tight text-foreground"
        }
      >
        {pretitle ? (
          <span
            className={
              isFooter
                ? "mb-1 block text-sm tracking-normal text-foreground"
                : "mb-2 block text-base tracking-normal text-foreground"
            }
          >
            {pretitle}
          </span>
        ) : null}{" "}
        {title}
      </h3>
      <p
        className={
          isFooter
            ? "mt-2 text-sm leading-6 text-muted-foreground"
            : "mt-3 text-base leading-7 text-muted-foreground"
        }
      >
        {description}
      </p>

      {isSubmitSuccessful ? (
        <div
          role="status"
          className={
            isFooter
              ? "mt-4 rounded-md border border-border bg-background p-4 text-sm text-foreground"
              : "mt-6 rounded-lg border border-border bg-background p-4 text-sm text-foreground"
          }
        >
          <p>{t("emailCapture.form.success")}</p>
          <a
            href={guideHref}
            className="mt-3 inline-block font-semibold text-primary hover:opacity-80"
          >
            {t("emailCapture.form.successCta")}
          </a>
        </div>
      ) : (
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start"
            noValidate
          >
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormLabel className={isFooter ? "sr-only" : undefined}>
                    {t("emailCapture.form.emailLabel")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder={t("emailCapture.form.emailPlaceholder")}
                      className={isFooter ? "bg-background" : undefined}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              disabled={form.formState.isSubmitting}
              className="shrink-0"
            >
              {form.formState.isSubmitting
                ? t("emailCapture.form.submitting")
                : t("emailCapture.form.submit")}
            </Button>
          </form>
        </Form>
      )}

      {submissionError ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {submissionError}
        </p>
      ) : null}

      {!isSubmitSuccessful && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("emailCapture.form.privacyNote")}
        </p>
      )}
    </div>
  );
}

"use client";

import {
  Bug,
  CheckCircle2,
  Lightbulb,
  MessageCircle,
  MessageSquareIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { Textarea } from "@/components/ui/textarea";
import { usePathname } from "@/i18n/navigation";
import { useAnalyticsConsent } from "@/lib/analytics/consent";
import { track } from "@/lib/analytics/track";
import useSubmitFeedback, {
  type FeedbackType,
} from "@/lib/api/feedback/useSubmitFeedback";
import {
  useConfirmedFeature,
  useSupportEmail,
} from "@/lib/api/instance/useInstance";
import { cn } from "@/lib/utils";
import { isAnalyticsEnabled } from "@/lib/utils/analytics-enabled";

import { Button, buttonVariants } from "../ui/button";
import { Link } from "../ui/Link";
import { Text } from "../ui/Typography";

const categories: {
  type: FeedbackType;
  labelKey: string;
  icon: React.ElementType;
}[] = [
  {
    type: "feature_request",
    labelKey: "feedback-feature-request",
    icon: Lightbulb,
  },
  { type: "bug", labelKey: "feedback-bug", icon: Bug },
  { type: "other", labelKey: "feedback-other", icon: MessageCircle },
];

/**
 * The "Share Feedback" panel. Feedback goes to `POST /v1/feedback`, which emails the
 * instance's support inbox; without it the form is not offered, as it would thank the user
 * for a message that nobody receives. With analytics consent, `feedback_submitted` records
 * its category, never the message.
 */
const Feedback = () => {
  const t = useTranslations();
  const pathname = usePathname();
  const supportEmail = useSupportEmail();
  const consent = useAnalyticsConsent();
  const sendsToApi = useConfirmedFeature(
    (features) => features.feedback === true,
  );
  const submitFeedback = useSubmitFeedback();

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<FeedbackType | null>(null);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  // The close animation's reset and the auto-close after sending. Cleared on unmount, so a
  // timer never sets state on an unmounted panel, and a reopen cancels a pending reset.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const handleOpenChange = (next: boolean) => {
    clearTimers();
    setOpen(next);
    if (!next) {
      // Reset state once the close animation has run
      later(() => {
        setSelected(null);
        setMessage("");
        setSubmitted(false);
        submitFeedback.reset();
      }, 300);
    }
  };

  const handleSubmit = async () => {
    if (!selected || !message.trim()) return;

    const feedback = {
      type: selected,
      message: message.trim(),
      page: pathname,
    };
    try {
      await submitFeedback.mutateAsync(feedback);
    } catch {
      // Shown below from the mutation's error state; the message stays for a retry.
      return;
    }
    if (isAnalyticsEnabled() && consent === "granted") {
      track("feedback_submitted", { category: selected });
    }

    setSubmitted(true);
    later(() => handleOpenChange(false), 2000);
  };

  const canShare = sendsToApi;
  const canSubmit =
    selected !== null && message.trim().length > 0 && !submitFeedback.isPending;

  if (!canShare && !supportEmail) return null;

  return (
    <div className="bg-card flex flex-col gap-2 rounded-md border px-3 py-3">
      {canShare && (
        <DrawerDialog
          open={open}
          onOpenChange={handleOpenChange}
          title={submitted ? undefined : t("feedback-title")}
          description={submitted ? undefined : t("feedback-description")}
          trigger={
            <button
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "w-full gap-1.5",
              )}
            >
              <MessageSquareIcon
                className="text-primary size-3.5"
                strokeWidth={2}
              />
              <Text variant="smallText" className="text-primary">
                {t("share-feedback")}
              </Text>
            </button>
          }
        >
          {submitted ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <CheckCircle2
                className="text-success-text size-10"
                strokeWidth={1.5}
              />
              <Text className="font-medium">{t("feedback-thank-you")}</Text>
              <Text variant="mutedText" className="text-sm">
                {t("feedback-thank-you-description")}
              </Text>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-2">
                {categories.map(({ type, labelKey, icon: Icon }) => (
                  <button
                    key={type}
                    onClick={() => setSelected(type)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-medium transition-colors",
                      selected === type
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary",
                    )}
                  >
                    <Icon className="size-4" strokeWidth={1.5} />
                    {t(labelKey)}
                  </button>
                ))}
              </div>
              <Textarea
                placeholder={t("feedback-placeholder")}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="min-h-[120px] resize-none"
              />
              {submitFeedback.isError && (
                <Text
                  role="alert"
                  variant="smallText"
                  className="text-destructive-text"
                >
                  {t("feedback-send-error")}
                </Text>
              )}
              <Button
                onClick={() => void handleSubmit()}
                disabled={!canSubmit}
                aria-busy={submitFeedback.isPending}
                className="w-full"
              >
                {submitFeedback.isPending
                  ? t("feedback-sending")
                  : t("feedback-submit")}
              </Button>
            </div>
          )}
        </DrawerDialog>
      )}
      {supportEmail && (
        <Text variant="mutedText" className="text-center text-xs">
          {t("or-email-us-at")}{" "}
          <Link
            href={`mailto:${supportEmail}`}
            className="text-primary hover:underline"
          >
            {supportEmail}
          </Link>
        </Text>
      )}
    </div>
  );
};

export default Feedback;

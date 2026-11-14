"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { getApiErrorCode } from "@/lib/api/errors";
import {
  calendarFeedUrl,
  useCalendarFeedToken,
  useResetCalendarFeedToken,
  useRevokeCalendarFeedToken,
} from "@/lib/api/user/useCalendarFeed";
import { formatShortDateForLocale } from "@/lib/utils/formatDate";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/Label";
import { Heading, Text } from "../ui/Typography";

/**
 * Settings > Account > Calendar feed.
 *
 * The feed's plain token exists only in the reset response, so the copyable link is shown once
 * and the list afterwards is the display prefix. Losing the link is not a problem: resetting it
 * mints a new one and retires the old.
 */
export default function CalendarFeed() {
  const t = useTranslations("calendarFeed");
  const locale = useLocale();
  const id = useId();
  const { data: token, isLoading } = useCalendarFeedToken();
  const reset = useResetCalendarFeedToken();
  const revoke = useRevokeCalendarFeedToken();

  const [totpCode, setTotpCode] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  const createdLink = createdToken ? calendarFeedUrl(createdToken, locale) : null;

  const onReset = async () => {
    try {
      const result = await reset.mutateAsync(
        totpCode.trim() ? { totpCode: totpCode.trim() } : {},
      );
      setCreatedToken(result.token);
      setTotpCode("");
    } catch (error) {
      const code = getApiErrorCode(error);
      toast.error(
        t(
          code === "totp_required"
            ? "error-totp-required"
            : code === "invalid_totp"
              ? "error-invalid-totp"
              : code === "session_not_fresh"
                ? "error-session-not-fresh"
                : "error-create",
        ),
      );
    }
  };

  const onCopy = async () => {
    if (!createdLink) return;
    try {
      await navigator.clipboard.writeText(createdLink);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copy-failed"));
    }
  };

  const onRevoke = async () => {
    try {
      await revoke.mutateAsync();
      setCreatedToken(null);
      toast.success(t("revoked"));
    } catch {
      toast.error(t("error-revoke"));
    } finally {
      setConfirmingRevoke(false);
    }
  };

  return (
    <div className="flex flex-col gap-10">
      <section className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-3">
        <div>
          <Heading variant="h2">{t("title")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("description")}
          </Text>
        </div>

        <div className="bg-card flex flex-col gap-4 rounded p-4 md:col-span-2">
          {createdLink ? (
            <div className="border-border flex flex-col gap-3 rounded border p-3">
              <Text className="font-medium">{t("created-title")}</Text>
              <Text variant="mutedText">{t("created-description")}</Text>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  readOnly
                  value={createdLink}
                  aria-label={t("created-title")}
                  className="font-mono"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button type="button" variant="default" onClick={() => void onCopy()}>
                  {t("copy")}
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="self-start"
                onClick={() => setCreatedToken(null)}
              >
                {t("created-done")}
              </Button>
            </div>
          ) : null}

          {isLoading ? (
            <Text variant="mutedText">{t("loading")}</Text>
          ) : token && !createdToken ? (
            <div className="flex flex-col gap-3">
              <Text className="font-medium">{t("active-title")}</Text>
              <Text variant="mutedText">
                {t("active-description", { prefix: `${token.prefix}…` })}
              </Text>
              <Text variant="mutedText">
                {t("created-on", {
                  date: formatShortDateForLocale(token.createdAt, locale),
                })}
              </Text>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="default"
                  loading={reset.isPending}
                  onClick={() => void onReset()}
                >
                  {t("reset")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setConfirmingRevoke(true)}
                >
                  {t("revoke")}
                </Button>
              </div>
            </div>
          ) : !createdToken ? (
            <div className="flex flex-col gap-3">
              <Text variant="mutedText">{t("empty")}</Text>
              <Button
                type="button"
                variant="default"
                className="self-start"
                loading={reset.isPending}
                onClick={() => void onReset()}
              >
                {t("create")}
              </Button>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-totp`}>{t("totp")}</Label>
            <Input
              id={`${id}-totp`}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={totpCode}
              maxLength={6}
              placeholder="123456"
              onChange={(event) => setTotpCode(event.target.value)}
            />
            <Text variant="mutedText">{t("totp-hint")}</Text>
          </div>
        </div>
      </section>

      <section className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-3">
        <div>
          <Heading variant="h2">{t("instructions-title")}</Heading>
        </div>

        <div className="bg-card flex flex-col gap-3 rounded p-4 md:col-span-2">
          <Text>{t("instructions-google")}</Text>
          <Text>{t("instructions-apple")}</Text>
          <Text variant="mutedText">{t("instructions-refresh")}</Text>
          <Text variant="mutedText">{t("instructions-privacy")}</Text>
        </div>
      </section>

      <AlertDialog open={confirmingRevoke} onOpenChange={setConfirmingRevoke}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("revoke-title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("revoke-description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onRevoke()}>
              {t("revoke-confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

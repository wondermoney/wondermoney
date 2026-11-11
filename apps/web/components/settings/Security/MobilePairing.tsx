"use client";

import { useLocale, useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import { Heading, Text } from "@/components/ui/Typography";
import { getApiErrorCode } from "@/lib/api/errors";
import {
  type MobileDevice,
  type PairingCode,
  useCreatePairingCode,
  useMobileDevices,
  useRevokeMobileDevice,
} from "@/lib/api/user/useMobileDevices";
import { formatShortDateForLocale } from "@/lib/utils/formatDate";

/** Whole seconds left before `expiresAt`, never negative. */
export function secondsRemaining(expiresAt: string, now: number): number {
  const expires = new Date(expiresAt).getTime();
  if (Number.isNaN(expires)) return 0;
  return Math.max(0, Math.ceil((expires - now) / 1000));
}

export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/**
 * Settings > Security > "Connect the mobile app".
 *
 * The QR carries a single-use code that lives for two minutes, so the panel counts it down and
 * offers a fresh one instead of leaving a dead code on screen. Minting a code hands out a
 * session, which is why it takes the same fresh-session/TOTP gate as an API token.
 */
export default function MobilePairing() {
  const t = useTranslations();
  const locale = useLocale();
  const id = useId();
  const { data: devices = [], isLoading } = useMobileDevices();
  const create = useCreatePairingCode();
  const revoke = useRevokeMobileDevice();

  const [pairingCode, setPairingCode] = useState<PairingCode | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [revoking, setRevoking] = useState<MobileDevice | null>(null);

  // One tick a second while a code is on screen; nothing runs otherwise.
  useEffect(() => {
    if (!pairingCode) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pairingCode]);

  const remaining = pairingCode ? secondsRemaining(pairingCode.expiresAt, now) : 0;
  const expired = pairingCode !== null && remaining === 0;

  const onShowCode = async () => {
    try {
      const created = await create.mutateAsync(
        totpCode.trim() ? totpCode.trim() : undefined,
      );
      setPairingCode(created);
      setNow(Date.now());
      setTotpCode("");
    } catch (error) {
      const code = getApiErrorCode(error);
      toast.error(
        t(
          code === "totp_required"
            ? "mobile-pairing-error-totp-required"
            : code === "invalid_totp"
              ? "mobile-pairing-error-invalid-totp"
              : code === "session_not_fresh"
                ? "mobile-pairing-error-session-not-fresh"
                : "mobile-pairing-error-create",
        ),
      );
    }
  };

  const onRevoke = async () => {
    if (!revoking) return;
    try {
      await revoke.mutateAsync(revoking.id);
      toast.success(t("mobile-devices-revoked"));
    } catch {
      toast.error(t("mobile-devices-error-revoke"));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div>
      <section className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-6 py-10 md:grid-cols-3">
        <div>
          <Heading variant="h2">{t("mobile-pairing-title")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("mobile-pairing-description")}
          </Text>
        </div>

        <div className="bg-card flex flex-col gap-4 rounded p-4 md:col-span-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-totp`}>{t("mobile-pairing-totp")}</Label>
            <Input
              id={`${id}-totp`}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={totpCode}
              maxLength={6}
              placeholder="123456"
              onChange={(event) => setTotpCode(event.target.value)}
            />
            <Text variant="mutedText">{t("mobile-pairing-totp-hint")}</Text>
          </div>

          <Button
            type="button"
            variant="default"
            className="self-start"
            loading={create.isPending}
            onClick={() => void onShowCode()}
          >
            {pairingCode ? t("mobile-pairing-new-code") : t("mobile-pairing-show-code")}
          </Button>

          {pairingCode ? (
            <div className="border-border flex flex-col items-center gap-3 rounded border p-4">
              <div
                role="img"
                aria-label={t("mobile-pairing-qr-label")}
                className="rounded bg-white p-3"
              >
                <QRCodeSVG value={pairingCode.url} size={200} />
              </div>
              <Text variant="mutedText" className="text-center">
                {expired
                  ? t("mobile-pairing-expired")
                  : t("mobile-pairing-expires-in", {
                      time: formatCountdown(remaining),
                    })}
              </Text>
              <Text variant="mutedText" className="text-center">
                {t("mobile-pairing-scan-hint")}
              </Text>
            </div>
          ) : null}
        </div>
      </section>

      <section className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-6 py-10 md:grid-cols-3">
        <div>
          <Heading variant="h2">{t("mobile-devices-title")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("mobile-devices-description")}
          </Text>
        </div>

        <div className="md:col-span-2">
          {isLoading ? (
            <Text variant="mutedText">{t("mobile-devices-loading")}</Text>
          ) : devices.length === 0 ? (
            <Text variant="mutedText">{t("mobile-devices-empty")}</Text>
          ) : (
            <ul className="divide-border divide-y">
              {devices.map((device) => (
                <li
                  key={device.id}
                  className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex flex-col gap-1">
                    <Text className="font-medium">{device.label}</Text>
                    <Text variant="mutedText">
                      {t("mobile-devices-last-seen", {
                        date: formatShortDateForLocale(device.lastSeenAt, locale, {
                          withTime: true,
                        }),
                      })}
                    </Text>
                    <Text variant="mutedText">
                      {t("mobile-devices-paired-on", {
                        date: formatShortDateForLocale(device.pairedAt, locale),
                      })}
                    </Text>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setRevoking(device)}
                  >
                    {t("mobile-devices-revoke")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <AlertDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("mobile-devices-revoke-title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("mobile-devices-revoke-description", {
                name: revoking?.label ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onRevoke()}>
              {t("mobile-devices-revoke-confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

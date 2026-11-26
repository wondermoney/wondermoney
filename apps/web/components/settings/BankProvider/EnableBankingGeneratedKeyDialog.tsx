"use client";

import { Check, Copy, Download } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import { Text } from "@/components/ui/Typography";
import { useEnableBankingSetup } from "@/lib/api/instance/useInstance";
import {
  type EnableBankingCertificate,
  useActivateEnableBankingCredential,
  useCreateEnableBankingCertificate,
} from "@/lib/api/user/useEnableBankingCredential";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";

import { enableBankingErrorKey } from "./enable-banking-errors";

const CERTIFICATE_FILE_NAME = "wondermoney-enable-banking.crt";

interface Props {
  triggerLabel: string;
  /** When the key the server generated earlier lapses, if one is waiting for its application ID. */
  pendingExpiresAt: string | null;
}

function downloadCertificate(certificatePem: string) {
  const url = URL.createObjectURL(
    new Blob([certificatePem], { type: "application/x-pem-file" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = CERTIFICATE_FILE_NAME;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * "Let WonderMoney create the key": the server generates the key pair and keeps the private key,
 * and this dialog hands out only its public certificate. The person registers the certificate in
 * Enable Banking's Control Panel with the values listed here (this server's own, from
 * `GET /v1/instance`), then pastes back the application ID. The full guided wizard is separate.
 */
export default function EnableBankingGeneratedKeyDialog({
  triggerLabel,
  pendingExpiresAt,
}: Props) {
  const t = useTranslations("bankProvider.generated");
  const format = useFormatter();
  const id = useId();
  const notifyIfRateLimited = useRateLimitToast();
  const setup = useEnableBankingSetup();
  const createCertificate = useCreateEnableBankingCertificate();
  const activate = useActivateEnableBankingCredential();

  const [open, setOpen] = useState(false);
  const [certificate, setCertificate] =
    useState<EnableBankingCertificate | null>(null);
  const [applicationId, setApplicationId] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const waitingUntil = certificate?.expiresAt ?? pendingExpiresAt;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setCertificate(null);
      setApplicationId("");
      setTotpCode("");
      setError(null);
      setCopiedField(null);
    }
  };

  const fail = (err: unknown) => {
    if (notifyIfRateLimited(err)) return;
    setError(t(enableBankingErrorKey(err)));
  };

  const onCreate = () => {
    setError(null);
    createCertificate.mutate(
      totpCode.trim() ? { totpCode: totpCode.trim() } : {},
      {
        onSuccess: (created) => {
          setCertificate(created);
          setTotpCode("");
        },
        onError: fail,
      },
    );
  };

  const onActivate = () => {
    setError(null);
    activate.mutate(
      {
        applicationId: applicationId.trim(),
        ...(totpCode.trim() ? { totpCode: totpCode.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast.success(t("toastActivated"));
          handleOpenChange(false);
        },
        onError: fail,
      },
    );
  };

  const copy = async (field: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  const controlPanelValues: { field: string; label: string; value: string }[] =
    setup
      ? [
          { field: "name", label: t("fieldName"), value: setup.applicationName },
          {
            field: "description",
            label: t("fieldDescription"),
            value: setup.applicationDescription,
          },
          {
            field: "redirectUrl",
            label: t("fieldRedirectUrl"),
            value: setup.redirectUrl,
          },
          {
            field: "privacyUrl",
            label: t("fieldPrivacyUrl"),
            value: setup.privacyUrl,
          },
          { field: "termsUrl", label: t("fieldTermsUrl"), value: setup.termsUrl },
        ]
      : [];

  const copyButton = (field: string, value: string, label: string) => (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={t("copyValue", { field: label })}
      onClick={() => void copy(field, value)}
    >
      {copiedField === field ? (
        <Check className="size-4" aria-hidden />
      ) : (
        <Copy className="size-4" aria-hidden />
      )}
    </Button>
  );

  return (
    <DrawerDialog
      title={t("title")}
      triggerLabel={triggerLabel}
      open={open}
      onOpenChange={handleOpenChange}
    >
      <div className="flex flex-col gap-6">
        <Text variant="mutedText" className="text-sm">
          {t("intro")}
        </Text>

        <section className="flex flex-col gap-3">
          <Text className="font-medium">{t("step1Title")}</Text>
          {certificate ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => downloadCertificate(certificate.certificatePem)}
              >
                <Download className="size-4" aria-hidden />
                {t("download")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void copy("certificate", certificate.certificatePem)
                }
              >
                {copiedField === "certificate" ? (
                  <Check className="size-4" aria-hidden />
                ) : (
                  <Copy className="size-4" aria-hidden />
                )}
                {t("copyCertificate")}
              </Button>
            </div>
          ) : (
            <>
              {pendingExpiresAt ? (
                <Text variant="mutedText" className="text-sm">
                  {t("pendingNotice", {
                    date: format.dateTime(new Date(pendingExpiresAt), {
                      dateStyle: "medium",
                    }),
                  })}
                </Text>
              ) : null}
              <Button
                type="button"
                variant={pendingExpiresAt ? "outline" : "default"}
                className="self-start"
                loading={createCertificate.isPending}
                disabled={createCertificate.isPending}
                onClick={onCreate}
              >
                {pendingExpiresAt ? t("recreate") : t("create")}
              </Button>
            </>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <Text className="font-medium">{t("step2Title")}</Text>
          <Text variant="mutedText" className="text-sm">
            {t("step2Intro")}
          </Text>
          <dl className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground text-xs">
                {t("fieldEnvironment")}
              </dt>
              <dd className="text-sm font-medium">{t("valueProduction")}</dd>
            </div>
            {controlPanelValues.map(({ field, label, value }) => (
              <div key={field} className="flex flex-col gap-1">
                <dt className="text-muted-foreground text-xs">{label}</dt>
                <dd className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={value}
                    aria-label={label}
                    className="font-mono text-xs"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  {copyButton(field, value, label)}
                </dd>
              </div>
            ))}
          </dl>
          <Text variant="mutedText" className="text-sm">
            {t("activateHint")}
          </Text>
        </section>

        <section className="flex flex-col gap-3">
          <Label htmlFor={`${id}-application-id`} className="font-medium">
            {t("step3Title")}
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={`${id}-application-id`}
              value={applicationId}
              autoComplete="off"
              spellCheck={false}
              placeholder={t("applicationIdPlaceholder")}
              className="font-mono"
              onChange={(event) => setApplicationId(event.target.value)}
            />
            <Button
              type="button"
              loading={activate.isPending}
              disabled={
                !waitingUntil ||
                applicationId.trim().length === 0 ||
                activate.isPending
              }
              onClick={onActivate}
            >
              {t("activate")}
            </Button>
          </div>
        </section>

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
          <Text variant="mutedText" className="text-xs">
            {t("totpHint")}
          </Text>
        </div>

        {error && <Alert variant="destructive">{error}</Alert>}
      </div>
    </DrawerDialog>
  );
}

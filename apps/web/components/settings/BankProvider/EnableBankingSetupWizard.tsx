"use client";

import type { AnalyticsBankKeySetupEntry } from "@wondermoney/shared/analytics";
import {
  ArrowLeft,
  Check,
  CircleCheck,
  Copy,
  Download,
  ExternalLink,
  TriangleAlert,
  X,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  type ClipboardEvent,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Typography";
import { track } from "@/lib/analytics/track";
import { API_ERROR_CODE, getApiErrorCode } from "@/lib/api/errors";
import { useEnableBankingSetup } from "@/lib/api/instance/useInstance";
import useEnableBankingCredential, {
  type EnableBankingCertificate,
  useActivateEnableBankingCredential,
  useCreateEnableBankingCertificate,
} from "@/lib/api/user/useEnableBankingCredential";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import { authClient } from "@/lib/auth/client";
import { docsLocaleFor } from "@/lib/docs-links";
import { instanceConfig } from "@/lib/instance";

import { enableBankingErrorKey } from "./enable-banking-errors";
import {
  claimReopenAfterSignIn,
  ENABLE_BANKING_SETUP_STEP as STEP,
  ENABLE_BANKING_SETUP_STEPS,
  type EnableBankingSetupStep,
  forgetRememberedStep,
  isSessionFreshForSetup,
  isTotpError,
  markReopenAfterSignIn,
  readRememberedStep,
  rememberStep,
  resolveResumeStep,
  revisitStepForError,
  stepNumber,
} from "./enable-banking-setup-steps";
import EnableBankingKeySetupDialog from "./EnableBankingKeySetupDialog";

const CERTIFICATE_FILE_NAME = "wondermoney-enable-banking.crt";
export const ENABLE_BANKING_SIGN_IN_URL = "https://enablebanking.com/sign-in/";
const DOCS_PAGE = "start-here/connect-first-bank-account";

/** The message key, under `bankProvider.wizard`, of each step's title. */
const TITLE_KEY = {
  [STEP.signIn]: "signIn.title",
  [STEP.createApplication]: "create.title",
  [STEP.activate]: "activate.title",
  [STEP.applicationId]: "applicationId.title",
  [STEP.done]: "done.title",
} as const satisfies Record<EnableBankingSetupStep, string>;

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

interface Props {
  /** Where it was opened from, for analytics (`bank_key_setup_started`). */
  entry: AnalyticsBankKeySetupEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The key is active (or a pasted one was saved): the caller shows the bank list. The wizard
   * has closed itself by then.
   */
  onChooseBank: () => void;
}

/**
 * The guided Enable Banking setup: sign in, create the application with this server's values,
 * activate it by linking an account, paste its ID, then on to the bank list. WonderMoney
 * generates the key pair (the private key never leaves the server) and hands out only the
 * certificate. Every place that needs a key before it can list banks opens this; a server whose
 * own application covers the household never does.
 *
 * Where it opens is the server's pending credential first (a certificate waiting for its ID
 * means steps 2 to 4), then the step this browser remembers. The step ids are stable
 * (`ENABLE_BANKING_SETUP_STEP`), for analytics to name: each opening sends
 * `bank_key_setup_started`, then `bank_key_setup_step_viewed` once for each step it shows.
 */
export default function EnableBankingSetupWizard({
  entry,
  open,
  onOpenChange,
  onChooseBank,
}: Props) {
  const t = useTranslations("bankProvider.wizard");
  const tGenerated = useTranslations("bankProvider.generated");
  const format = useFormatter();
  const locale = useLocale();
  const id = useId();
  const notifyIfRateLimited = useRateLimitToast();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id;
  const twoFactorEnabled = Boolean(session?.user?.twoFactorEnabled);
  // Both server calls need a session from the last 24 hours: say so before step 1, not at step 2.
  const sessionFresh = isSessionFreshForSetup(session?.session?.createdAt);
  const setup = useEnableBankingSetup();
  const credentialQuery = useEnableBankingCredential({ enabled: open });
  const createCertificate = useCreateEnableBankingCertificate();
  const activate = useActivateEnableBankingCredential();

  // Null until the person moves: the wizard then opens where the server and this browser say.
  const [chosenStep, setChosenStep] = useState<EnableBankingSetupStep | null>(
    null,
  );
  // The certificate created here, kept while this stays mounted so closing and reopening still
  // offers the download, but shown only while it is still the server's pending key (below).
  const [certificate, setCertificate] =
    useState<EnableBankingCertificate | null>(null);
  const [applicationId, setApplicationId] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpAsked, setTotpAsked] = useState(false);
  const [certificateError, setCertificateError] = useState<string | null>(null);
  const [activateError, setActivateError] = useState<{
    message: string;
    revisit: EnableBankingSetupStep | null;
    signInAgain: boolean;
  } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);

  const credentialKnown = credentialQuery.isSuccess || credentialQuery.isError;
  const step: EnableBankingSetupStep | null =
    chosenStep ??
    (credentialKnown
      ? resolveResumeStep(credentialQuery.data, readRememberedStep(userId))
      : null);
  const pendingExpiresAt = credentialQuery.data?.pending?.expiresAt ?? null;
  // Removed, lapsed or replaced since it was created: then it registers nothing, so it is not
  // offered, and step 2 offers a new one instead.
  const liveCertificate =
    certificate &&
    pendingExpiresAt &&
    new Date(certificate.expiresAt).getTime() ===
      new Date(pendingExpiresAt).getTime()
      ? certificate
      : null;
  const showTotp = twoFactorEnabled || totpAsked;
  // A step behind the "sign in again" notice is not shown yet.
  const needsSignIn = Boolean(step && step !== STEP.done && !sessionFresh);
  const shownStep = open && !needsSignIn ? step : null;

  // Once per opening, then once per step shown in it: a re-render, or coming back to a step,
  // sends nothing more. Closing starts the count again.
  const tracked = useRef<{
    started: boolean;
    steps: Set<EnableBankingSetupStep>;
  }>({
    started: false,
    steps: new Set(),
  });
  useEffect(() => {
    if (!open) {
      tracked.current = { started: false, steps: new Set() };
      return;
    }
    if (!tracked.current.started) {
      tracked.current.started = true;
      track("bank_key_setup_started", { entry });
    }
    if (shownStep && !tracked.current.steps.has(shownStep)) {
      tracked.current.steps.add(shownStep);
      track("bank_key_setup_step_viewed", { step: shownStep });
    }
  }, [entry, open, shownStep]);
  const docsUrl = `${instanceConfig.docsUrl}/${docsLocaleFor(locale)}/docs/${DOCS_PAGE}`;

  const goTo = (next: EnableBankingSetupStep) => {
    setChosenStep(next);
    setActivateError(null);
    setCertificateError(null);
    if (next === STEP.done) forgetRememberedStep(userId);
    else rememberStep(userId, next);
  };

  // Back from signing in again: open where the person left off.
  const reopenAfterSignIn = useEffectEvent(() => onOpenChange(true));
  useEffect(() => {
    if (claimReopenAfterSignIn(window.location.pathname)) reopenAfterSignIn();
  }, []);

  const signInAgain = async () => {
    const next = `${window.location.pathname}${window.location.search}`;
    markReopenAfterSignIn(window.location.pathname);
    await authClient.signOut().catch(() => undefined);
    const login = new URL(`/${locale}/auth/login`, window.location.origin);
    login.searchParams.set("next", next);
    window.location.assign(login.toString());
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setChosenStep(null);
      setApplicationId("");
      setTotpCode("");
      setActivateError(null);
      setCertificateError(null);
      setCopiedField(null);
    }
    onOpenChange(next);
  };

  // The code is used once: whatever the answer, the next attempt asks for a fresh one.
  const takeTotpInput = () => {
    const code = totpCode.trim();
    setTotpCode("");
    return code ? { totpCode: code } : {};
  };

  const onCreateCertificate = () => {
    setCertificateError(null);
    createCertificate.mutate(takeTotpInput(), {
      onSuccess: (created) => {
        setCertificate(created);
        rememberStep(userId, STEP.createApplication);
      },
      onError: (err) => {
        if (notifyIfRateLimited(err)) return;
        if (isTotpError(err)) setTotpAsked(true);
        setCertificateError(tGenerated(enableBankingErrorKey(err)));
      },
    });
  };

  const onActivate = (value = applicationId) => {
    const trimmed = value.trim();
    if (!trimmed || activate.isPending) return;
    setActivateError(null);
    activate.mutate(
      { applicationId: trimmed, ...takeTotpInput() },
      {
        onSuccess: () => {
          setApplicationId("");
          goTo(STEP.done);
        },
        onError: (err) => {
          if (notifyIfRateLimited(err)) return;
          if (isTotpError(err)) setTotpAsked(true);
          const code = getApiErrorCode(err);
          // The key it was checking is gone: drop its certificate too (the credential refetches).
          if (
            code === API_ERROR_CODE.ENABLE_BANKING_PENDING_CREDENTIAL_MISSING
          ) {
            setCertificate(null);
          }
          setActivateError({
            message: tGenerated(enableBankingErrorKey(err)),
            revisit: revisitStepForError(err),
            signInAgain: code === "session_not_fresh",
          });
        },
      },
    );
  };

  // A pasted ID is checked straight away; typed, it waits for Activate or Enter. With the
  // authenticator code still to enter, the paste only fills the field.
  const onPasteApplicationId = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text").trim();
    if (!pasted) return;
    event.preventDefault();
    setApplicationId(pasted);
    if (!showTotp || totpCode.trim()) onActivate(pasted);
  };

  const chooseBank = () => {
    handleOpenChange(false);
    onChooseBank();
  };

  const openPasteForm = () => {
    handleOpenChange(false);
    setPasteOpen(true);
  };

  const copy = async (field: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      toast.success(tGenerated("copied"));
    } catch {
      toast.error(tGenerated("copyFailed"));
    }
  };

  const copyIcon = (field: string) =>
    copiedField === field ? (
      <Check className="size-4" aria-hidden />
    ) : (
      <Copy className="size-4" aria-hidden />
    );

  const controlPanelValues: { field: string; label: string; value: string }[] =
    setup
      ? [
          {
            field: "name",
            label: tGenerated("fieldName"),
            value: setup.applicationName,
          },
          {
            field: "description",
            label: tGenerated("fieldDescription"),
            value: setup.applicationDescription,
          },
          {
            field: "redirectUrl",
            label: tGenerated("fieldRedirectUrl"),
            value: setup.redirectUrl,
          },
          {
            field: "privacyUrl",
            label: tGenerated("fieldPrivacyUrl"),
            value: setup.privacyUrl,
          },
          {
            field: "termsUrl",
            label: tGenerated("fieldTermsUrl"),
            value: setup.termsUrl,
          },
        ]
      : [];

  const totpField = showTotp ? (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`${id}-totp`}>{tGenerated("totp")}</Label>
      <Input
        id={`${id}-totp`}
        inputMode="numeric"
        autoComplete="one-time-code"
        value={totpCode}
        maxLength={6}
        className="font-mono sm:max-w-40"
        onChange={(event) => setTotpCode(event.target.value)}
      />
    </div>
  ) : null;

  const guideLink = (
    <a
      href={docsUrl}
      target="_blank"
      rel="noreferrer"
      className="text-primary inline-flex items-center gap-1 self-start text-sm underline-offset-4 hover:underline focus-visible:underline"
    >
      {t("guide")}
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );

  const stepIndex = step ? stepNumber(step) : 0;
  const backTo =
    step && step !== STEP.signIn && step !== STEP.done
      ? ENABLE_BANKING_SETUP_STEPS[stepIndex - 2]
      : null;

  const backButton = backTo ? (
    <Button type="button" variant="ghost" onClick={() => goTo(backTo)}>
      <ArrowLeft className="size-4" aria-hidden />
      {t("back")}
    </Button>
  ) : null;

  const footerFor = (primary: React.ReactNode) => (
    <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-between">
      {backButton ?? <span className="hidden sm:block" />}
      {primary}
    </div>
  );

  const nextButton = (next: EnableBankingSetupStep, disabled = false) => (
    <Button type="button" disabled={disabled} onClick={() => goTo(next)}>
      {t("next")}
    </Button>
  );

  let body: React.ReactNode = (
    <div className="flex justify-center py-8">
      <Spinner />
    </div>
  );
  let footer: React.ReactNode = undefined;

  if (needsSignIn) {
    body = (
      <Text variant="mutedText" className="text-sm">
        {t("signInAgain.body")}
      </Text>
    );
    footer = (
      <Button
        type="button"
        className="w-full sm:w-auto"
        onClick={() => void signInAgain()}
      >
        {t("signInAgain.action")}
      </Button>
    );
  } else if (step === STEP.signIn) {
    body = (
      <div className="flex flex-col gap-4">
        <Text variant="mutedText" className="text-sm">
          {t("signIn.body")}
        </Text>
        <Button asChild variant="secondary" className="self-start">
          <a href={ENABLE_BANKING_SIGN_IN_URL} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" aria-hidden />
            {t("signIn.open")}
          </a>
        </Button>
        {guideLink}
      </div>
    );
    footer = footerFor(nextButton(STEP.createApplication));
  } else if (step === STEP.createApplication) {
    const hasCertificate = Boolean(pendingExpiresAt);
    body = (
      <div className="flex flex-col gap-6">
        <Text variant="mutedText" className="text-sm">
          {t("create.body")}
        </Text>

        <Alert variant="warning" role="note">
          <TriangleAlert className="size-4" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">{t("create.environment")}</p>
            <p className="text-sm">{t("create.environmentWhy")}</p>
          </div>
        </Alert>

        <dl className="flex flex-col gap-4">
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
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="shrink-0"
                  aria-label={tGenerated("copyValue", { field: label })}
                  onClick={() => void copy(field, value)}
                >
                  {copyIcon(field)}
                </Button>
              </dd>
            </div>
          ))}
        </dl>
        {setup ? (
          <Text variant="mutedText" className="-mt-2 text-xs">
            {t("create.urlsRequired")}
          </Text>
        ) : null}

        <section className="flex flex-col gap-3" aria-labelledby={`${id}-cert`}>
          <p id={`${id}-cert`} className="text-sm font-medium">
            {t("create.certificate")}
          </p>
          <Text variant="mutedText" className="text-sm">
            {t("create.certificateHint")}
          </Text>
          {liveCertificate ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  downloadCertificate(liveCertificate.certificatePem)
                }
              >
                <Download className="size-4" aria-hidden />
                {tGenerated("download")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  void copy("certificate", liveCertificate.certificatePem)
                }
              >
                {copyIcon("certificate")}
                {tGenerated("copyCertificate")}
              </Button>
            </div>
          ) : (
            <>
              {pendingExpiresAt ? (
                <Text variant="mutedText" className="text-sm">
                  {t("create.waiting", {
                    date: format.dateTime(new Date(pendingExpiresAt), {
                      dateStyle: "medium",
                    }),
                  })}
                </Text>
              ) : null}
              {totpField}
              <Button
                type="button"
                variant="secondary"
                className="self-start"
                loading={createCertificate.isPending}
                disabled={createCertificate.isPending}
                onClick={onCreateCertificate}
              >
                {pendingExpiresAt
                  ? tGenerated("recreate")
                  : tGenerated("create")}
              </Button>
            </>
          )}
          {certificateError ? (
            <Alert variant="destructive" className="text-sm">
              {certificateError}
            </Alert>
          ) : null}
        </section>

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="link"
            className="h-auto self-start p-0"
            onClick={openPasteForm}
          >
            {t("create.haveKey")}
          </Button>
          {guideLink}
        </div>
      </div>
    );
    footer = footerFor(nextButton(STEP.activate, !hasCertificate));
  } else if (step === STEP.activate) {
    body = (
      <div className="flex flex-col gap-4">
        <Text variant="mutedText" className="text-sm">
          {t("activate.body")}
        </Text>
        {/* The two buttons the application's page shows, drawn with our own parts: the one to
            press, and the one to skip. */}
        <ul className="divide-border divide-y">
          <li className="flex items-start gap-3 py-3">
            <Check
              className="text-success-text mt-0.5 size-4 shrink-0"
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("activate.link")}</p>
              <p className="text-muted-foreground text-xs leading-5">
                {t("activate.linkHint")}
              </p>
            </div>
          </li>
          <li className="flex items-start gap-3 py-3">
            <X
              className="text-muted-foreground mt-0.5 size-4 shrink-0"
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-muted-foreground text-sm font-medium">
                {t("activate.request")}
              </p>
              <p className="text-muted-foreground text-xs leading-5">
                {t("activate.requestHint")}
              </p>
            </div>
          </li>
        </ul>
        {guideLink}
      </div>
    );
    footer = footerFor(nextButton(STEP.applicationId));
  } else if (step === STEP.applicationId) {
    const errorId = `${id}-application-id-error`;
    body = (
      <form
        id={`${id}-activate`}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onActivate();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-application-id`}>
            {t("applicationId.label")}
          </Label>
          <Input
            id={`${id}-application-id`}
            value={applicationId}
            autoComplete="off"
            spellCheck={false}
            placeholder={tGenerated("applicationIdPlaceholder")}
            className="font-mono"
            aria-invalid={activateError ? true : undefined}
            aria-describedby={activateError ? errorId : undefined}
            onPaste={onPasteApplicationId}
            onChange={(event) => {
              setApplicationId(event.target.value);
              setActivateError(null);
            }}
          />
          <Text variant="mutedText" className="text-xs">
            {t("applicationId.hint")}
          </Text>
        </div>
        {totpField}
        {activate.isPending ? (
          <div
            aria-live="polite"
            className="text-muted-foreground flex items-center gap-2 text-sm"
          >
            <Spinner />
            <span>{t("applicationId.checking")}</span>
          </div>
        ) : null}
        {activateError ? (
          <div className="flex flex-col gap-2">
            <p
              id={errorId}
              role="alert"
              className="text-destructive-text text-sm"
            >
              {activateError.message}
            </p>
            {activateError.signInAgain ? (
              <Button
                type="button"
                variant="secondary"
                className="self-start"
                onClick={() => void signInAgain()}
              >
                {t("signInAgain.action")}
              </Button>
            ) : null}
            {activateError.revisit ? (
              <Button
                type="button"
                variant="secondary"
                className="self-start"
                onClick={() => goTo(activateError.revisit!)}
              >
                {t("applicationId.revisit", {
                  step: stepNumber(activateError.revisit),
                  title: t(TITLE_KEY[activateError.revisit]),
                })}
              </Button>
            ) : null}
          </div>
        ) : null}
        {guideLink}
      </form>
    );
    footer = footerFor(
      <Button
        type="submit"
        form={`${id}-activate`}
        loading={activate.isPending}
        disabled={applicationId.trim().length === 0 || activate.isPending}
      >
        {tGenerated("activate")}
      </Button>,
    );
  } else if (step === STEP.done) {
    body = (
      <div className="flex items-start gap-3">
        <CircleCheck
          className="text-success-text mt-0.5 size-5 shrink-0"
          aria-hidden
        />
        <Text className="text-sm">{t("done.body")}</Text>
      </div>
    );
    footer = (
      <Button type="button" className="w-full sm:w-auto" onClick={chooseBank}>
        {t("done.chooseBank")}
      </Button>
    );
  }

  return (
    <>
      <DrawerDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={
          needsSignIn
            ? t("signInAgain.title")
            : step
              ? t(TITLE_KEY[step])
              : t("title")
        }
        description={
          step && step !== STEP.done && !needsSignIn
            ? t("progress", {
                current: stepIndex,
                total: ENABLE_BANKING_SETUP_STEPS.length - 1,
              })
            : undefined
        }
        footer={footer}
      >
        {body}
      </DrawerDialog>
      <EnableBankingKeySetupDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        isUpdate={credentialQuery.data?.status === "active"}
        onSaved={() => {
          forgetRememberedStep(userId);
          onChooseBank();
        }}
      />
    </>
  );
}

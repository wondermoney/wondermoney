"use client";

import { ArrowLeft, ExternalLink, LockKeyhole, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useEffect, useRef, useState } from "react";

import { saveBankAccountSyncReturnMarker } from "@/lib/account/bank-account-sync-return-marker";
import { safelyRunDiagnostic } from "@/lib/analytics/safe-diagnostics";
import useBankList from "@/lib/api/banking/useBankList";
import useCreateRequisition from "@/lib/api/banking/useCreateRequisition";
import useEnableBankingCredential from "@/lib/api/user/useEnableBankingCredential";
import { isBankConnectionsPaused } from "@/lib/utils/bank-connections-paused";
import { getCountryCodeClient } from "@/lib/utils/countries";
import { SUPPORTED_BANK_COUNTRY_CODES } from "@/lib/utils/countries/bank-countries";
import { countryFlags } from "@/lib/utils/countries/country-flag";

import { Button } from "../ui/button";
import { ComboBox } from "../ui/combobox";
import { DrawerDialog } from "../ui/dialog-responsive";
import { Label } from "../ui/Label";
import { Link } from "../ui/Link";
import { Spinner } from "../ui/Spinner";
import BankList from "./BankList";

interface AccountAddSyncModalProps {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  page?: string;
}

const AccountAddSyncModal: React.FC<AccountAddSyncModalProps> = ({
  isOpen,
  setOpen,
  page = "accounts",
}) => {
  const t = useTranslations();
  const posthog = usePostHog();
  const bankConnectionsPaused = isBankConnectionsPaused();
  // Gating order matches AccountCreateModal: paused (unchanged, first priority)
  // takes precedence over the BYOK credential check, which only runs once
  // bank-sync isn't already paused globally.
  const { data: enableBankingCredential, isLoading: credentialLoading } =
    useEnableBankingCredential({ enabled: !bankConnectionsPaused });
  const credentialRequired =
    !bankConnectionsPaused &&
    !credentialLoading &&
    enableBankingCredential?.status !== "active";
  const [bankId, setBankId] = useState<string | null>(null);
  const [continueRequested, setContinueRequested] = useState(false);
  const [redirectStarted, setRedirectStarted] = useState(false);
  const expectationHeadingRef = useRef<HTMLHeadingElement>(null);
  const [country, setCountry] = useState<string>(() => getCountryCodeClient());
  const {
    data: bankListData,
    isLoading: bankListLoading,
    isFetching,
  } = useBankList(country, {
    enabled: !!country && !bankConnectionsPaused && !credentialRequired,
    staleTime: Infinity,
  });

  const {
    data: createRequisitionData,
    isError: createRequisitionError,
    isFetching: isFetchingRedirect,
    refetch: retryCreateRequisition,
  } = useCreateRequisition(bankId!, page, {
    enabled: Boolean(bankId) && continueRequested,
    retry: false,
  });

  useEffect(() => {
    if (bankId && !continueRequested) expectationHeadingRef.current?.focus();
  }, [bankId, continueRequested]);

  useEffect(() => {
    if (
      continueRequested &&
      createRequisitionData?.redirectUrl &&
      !redirectStarted
    ) {
      setRedirectStarted(true);
      safelyRunDiagnostic(() => {
        posthog.capture("account_add_sync_before_redirect", {
          source: page === "accounts" ? "accounts" : "budget",
          state: "redirecting",
        });
      });
      saveBankAccountSyncReturnMarker(page);
      window.location.href = createRequisitionData.redirectUrl;
    }
  }, [
    continueRequested,
    createRequisitionData?.redirectUrl,
    page,
    posthog,
    redirectStarted,
  ]);

  const onCloseModal = () => {
    setBankId(null);
    setContinueRequested(false);
    setRedirectStarted(false);
    setOpen(false);
  };

  const onContinue = () => {
    if (isFetchingRedirect || redirectStarted) return;
    if (continueRequested) {
      void retryCreateRequisition();
      return;
    }
    setContinueRequested(true);
  };

  const onBack = () => {
    setBankId(null);
    setContinueRequested(false);
    setRedirectStarted(false);
  };

  const selectedBank = bankListData?.find((bank) => bank.id === bankId);

  const countryOptions = Object.values(countryFlags)
    .filter((country) => SUPPORTED_BANK_COUNTRY_CODES.includes(country.code))
    .map((country) => ({
      label: `${country.emoji} ${country.name}`,
      value: country.code,
    }));

  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onCloseModal();
      }}
      title={
        bankId ? t("bank-connection-expectation-title") : t("add-account")
      }
      description={
        bankId
          ? t("bank-connection-expectation-description", {
              bank: selectedBank?.name ?? t("your-bank"),
            })
          : undefined
      }
      footer={
        bankId ? (
          <div className="flex w-full flex-col gap-2 sm:flex-row-reverse sm:justify-between">
            <Button
              type="button"
              className="h-11"
              onClick={onContinue}
              loading={isFetchingRedirect || redirectStarted}
              disabled={isFetchingRedirect || redirectStarted}
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              {t("continue-to-bank")}
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="ghost"
                className="h-11"
                onClick={onBack}
                disabled={isFetchingRedirect || redirectStarted}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                {t("back")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11"
                onClick={onCloseModal}
                disabled={redirectStarted}
              >
                {t("cancel")}
              </Button>
            </div>
          </div>
        ) : undefined
      }
    >
      <div className="flex min-h-0 w-full flex-col gap-4">
        {bankId ? (
          <div className="space-y-4">
            <h3 ref={expectationHeadingRef} tabIndex={-1} className="sr-only">
              {t("bank-connection-expectation-title")}
            </h3>
            <div className="border-border bg-muted/40 rounded-lg border p-4">
              <ul className="space-y-4 text-sm">
                <li className="flex gap-3">
                  <ExternalLink
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{t("bank-connection-expectation-leave")}</span>
                </li>
                <li className="flex gap-3">
                  <ShieldCheck
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{t("bank-connection-expectation-read-only")}</span>
                </li>
                <li className="flex gap-3">
                  <LockKeyhole
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{t("bank-connection-expectation-credentials")}</span>
                </li>
              </ul>
            </div>
            <div aria-live="polite" aria-atomic="true" className="min-h-5">
              {isFetchingRedirect || redirectStarted ? (
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Spinner />
                  <span>{t("redirecting-to-bank")}</span>
                </div>
              ) : createRequisitionError ? (
                <p className="text-destructive-text text-sm" role="alert">
                  {t("bank-connection-redirect-error")}
                </p>
              ) : null}
            </div>
          </div>
        ) : bankConnectionsPaused ? (
          <div
            aria-disabled="true"
            className="border-border bg-muted/40 text-muted-foreground flex flex-col items-start gap-3 rounded-lg border p-4"
          >
            <p className="text-foreground text-sm font-semibold">
              {t("bankConnectionsPaused.title")}
            </p>
            <p className="text-sm">{t("bankConnectionsPaused.body")}</p>
            <Link
              href="/faq"
              className="text-primary text-sm font-semibold underline underline-offset-2"
            >
              {t("bankConnectionsPaused.cta")}
            </Link>
          </div>
        ) : credentialLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : credentialRequired ? (
          <div
            aria-disabled="true"
            className="border-border bg-muted/40 text-muted-foreground flex flex-col items-start gap-3 rounded-lg border p-4"
          >
            <p className="text-foreground text-sm font-semibold">
              {t("bankProviderCredentialRequired.title")}
            </p>
            <p className="text-sm">
              {t("bankProviderCredentialRequired.body")}
            </p>
            <Link
              href="/settings?tab=bank-provider"
              className="text-primary text-sm font-semibold underline underline-offset-2"
            >
              {t("bankProviderCredentialRequired.cta")}
            </Link>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="country">{t("country")}</Label>
              <ComboBox
                id="country"
                defaultValue={country}
                triggerClassName="h-11 w-full"
                options={countryOptions}
                onSelect={(opt) => setCountry(opt?.value ?? "")}
              />
            </div>
            {isFetching && bankListLoading ? (
              <Spinner />
            ) : country && bankListData ? (
              <BankList bankList={bankListData} onClick={setBankId} />
            ) : null}
          </>
        )}
      </div>
    </DrawerDialog>
  );
};

export default AccountAddSyncModal;

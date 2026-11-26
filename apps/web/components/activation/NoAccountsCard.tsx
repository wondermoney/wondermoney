"use client";

import { FileText, Landmark, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import AccountAddModal from "@/components/account/AccountCreateModal";
import AccountAddOfflineModal from "@/components/account/AccountCreateOfflineModal";
import AccountAddSyncModal from "@/components/account/AccountCreateSyncModal";
import StatementImportFlow, {
  useStatementImportAvailable,
} from "@/components/account/StatementImportFlow";
import EnableBankingSetupWizard from "@/components/settings/BankProvider/EnableBankingSetupWizard";
import { useSimplefinAvailable } from "@/components/settings/Connections/SimplefinConnectButton";
import useAccounts from "@/lib/api/account/useAccounts";
import { useFeature, useInstanceKnown } from "@/lib/api/instance/useInstance";
import useBankLinkCredential from "@/lib/api/user/useBankLinkCredential";
import { useIsHouseholdViewer } from "@/lib/household/useIsHouseholdViewer";

import { NoAccountOptionList } from "./NoAccountOptions";

/**
 * Home for a household with no accounts at all: the three ways in, each opening the flow the
 * rest of the app already uses. "Connect a bank" opens the Enable Banking setup wizard when a
 * key is still needed and Enable Banking is the only bank provider, and the wizard goes on to
 * the bank list; otherwise it opens the add-account dialog, which knows which bank providers
 * this server has. The other two are the ones first run offers after skipping the bank.
 *
 * It shows only while the account list is loaded and empty, so the first account takes it
 * away, and never to a household viewer, who cannot add one. A dialog already open stays mounted after that, until it is closed: importing a
 * statement creates the account first and then opens the import on it. With accounts and no
 * dialog open, nothing mounts, so the dialogs' own requests are not made for everyone.
 */
export function NoAccountsCard() {
  const t = useTranslations("homeOverview.noAccounts");
  const visible = useNoAccountsCardShown();
  const headingId = useId();
  const importAvailable = useStatementImportAvailable();
  const [addOpen, setAddOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  // Asked only while the card shows, so a household with accounts makes no request for it.
  const { credentialRequired, loading: credentialLoading } =
    useBankLinkCredential({ enabled: visible });
  const instanceKnown = useInstanceKnown();
  const enableBankingAvailable = useFeature(
    (features) =>
      features.bankSyncProviders?.includes("enable_banking") ?? true,
  );
  const simplefinAvailable = useSimplefinAvailable();
  // Where "Connect a bank" leads, once the server's providers and the key are known; until
  // then a press waits for the answer rather than guess (SimpleFIN reads as off while unknown).
  const connectPath =
    !instanceKnown || credentialLoading
      ? null
      : credentialRequired && enableBankingAvailable && !simplefinAvailable
        ? "wizard"
        : "add";
  const [connectRequested, setConnectRequested] = useState(false);
  if (connectRequested && connectPath) {
    setConnectRequested(false);
    if (connectPath === "wizard") setWizardOpen(true);
    else setAddOpen(true);
  }

  if (
    !visible &&
    !addOpen &&
    !syncOpen &&
    !manualOpen &&
    !importOpen &&
    !wizardOpen
  )
    return null;

  return (
    <>
      {visible ? (
        <section
          aria-labelledby={headingId}
          className="flex flex-col gap-2 pt-2"
        >
          <h2 id={headingId} className="text-foreground text-sm font-medium">
            {t("title")}
          </h2>
          <NoAccountOptionList
            options={[
              {
                key: "connect",
                icon: Landmark,
                label: t("connect"),
                onSelect: () => setConnectRequested(true),
              },
              ...(importAvailable
                ? [
                    {
                      key: "import",
                      icon: FileText,
                      label: t("import"),
                      hint: t("importHint"),
                      onSelect: () => setImportOpen(true),
                    },
                  ]
                : []),
              {
                key: "manual",
                icon: Pencil,
                label: t("manual"),
                hint: t("manualHint"),
                onSelect: () => setManualOpen(true),
              },
            ]}
          />
        </section>
      ) : null}

      <AccountAddModal
        isOpen={addOpen}
        setOpen={setAddOpen}
        onAddSyncAccountClick={() => {
          setAddOpen(false);
          setSyncOpen(true);
        }}
        onAddOfflineAccountClick={() => {
          setAddOpen(false);
          setManualOpen(true);
        }}
        trigger={false}
      />
      <AccountAddSyncModal isOpen={syncOpen} setOpen={setSyncOpen} />
      <EnableBankingSetupWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onChooseBank={() => setSyncOpen(true)}
      />
      <AccountAddOfflineModal
        isOpen={manualOpen}
        closeModal={() => setManualOpen(false)}
      />
      {importAvailable ? (
        <StatementImportFlow
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImported={() => setImportOpen(false)}
        />
      ) : null}
    </>
  );
}

/**
 * Whether Home shows the card: the account list has loaded and holds nothing (not while it
 * loads, nor after it failed), and the person may add an account (not a household viewer).
 */
export function useNoAccountsCardShown(): boolean {
  const { data, isSuccess } = useAccounts();
  const viewer = useIsHouseholdViewer();
  return isSuccess && (data?.accounts?.length ?? 0) === 0 && !viewer;
}

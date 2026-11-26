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
import useAccounts from "@/lib/api/account/useAccounts";

import { NoAccountOptionList } from "./NoAccountOptions";

/**
 * Home for a household with no accounts at all: the three ways in, each opening the flow the
 * rest of the app already uses. "Connect a bank" opens the add-account dialog, which knows
 * which bank providers this server has and whether a key is still needed; the other two are
 * the ones first run offers after skipping the bank.
 *
 * It shows only while the account list is loaded and empty, so the first account takes it
 * away. A dialog already open stays mounted after that, until it is closed: importing a
 * statement creates the account first and then opens the import on it. With accounts and no
 * dialog open, nothing mounts, so the dialogs' own requests are not made for everyone.
 */
export function NoAccountsCard() {
  const t = useTranslations("homeOverview.noAccounts");
  const visible = useHasNoAccounts();
  const headingId = useId();
  const importAvailable = useStatementImportAvailable();
  const [addOpen, setAddOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  if (!visible && !addOpen && !syncOpen && !manualOpen && !importOpen)
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
                onSelect: () => setAddOpen(true),
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

/** The account list has loaded and holds nothing: not while it loads, nor after it failed. */
export function useHasNoAccounts(): boolean {
  const { data, isSuccess } = useAccounts();
  return isSuccess && (data?.accounts?.length ?? 0) === 0;
}

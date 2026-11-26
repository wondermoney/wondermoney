"use client";

import { useState } from "react";

import AccountAddOfflineModal from "@/components/account/AccountCreateOfflineModal";
import AccountTransactionImportModal from "@/components/account/AccountTransactionImportModal";
import { writableAccounts } from "@/lib/account/account-access";
import useAccounts from "@/lib/api/account/useAccounts";
import { useFeature } from "@/lib/api/instance/useInstance";

/**
 * Whether this server takes statement files: a CSV import uploads to storage first, so a
 * server without storage offers none (`AccountTransactionImportModal` renders nothing there).
 */
export function useStatementImportAvailable(): boolean {
  return useFeature((features) => features.fileStorage);
}

/**
 * "Import a statement" for someone who may have no account yet. A statement is imported into
 * an account, so with none to write to the existing manual-account dialog comes first, and the
 * existing import dialog opens on the account it created. With one, the import opens directly.
 *
 * `onImported` fires once the import has written its transactions; `onClose` when the person
 * leaves either dialog. An account created before leaving stays: it is a real account, and
 * `onAccountAdded` says so.
 */
export default function StatementImportFlow({
  open,
  onClose,
  onImported,
  onAccountAdded,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  onAccountAdded?: () => void;
}) {
  const { data } = useAccounts();
  const accounts = writableAccounts(data?.accounts ?? []);
  // The new account reaches the list before the dialog's success callback runs
  // (`useCreateOfflineAccount` refetches first); this only closes the account
  // dialog should that refetch come back without it.
  const [accountAdded, setAccountAdded] = useState(false);
  const needsAccount = accounts.length === 0;

  return (
    <>
      <AccountAddOfflineModal
        isOpen={open && needsAccount && !accountAdded}
        // On success the import takes over once the account is listed; leaving is `onCancel`.
        closeModal={() => {}}
        onCancel={onClose}
        onSuccess={() => {
          setAccountAdded(true);
          onAccountAdded?.();
        }}
      />
      {needsAccount ? null : (
        <AccountTransactionImportModal
          isOpen={open}
          setOpen={(next) => {
            if (!next) onClose();
          }}
          accounts={accounts}
          trigger={null}
          onImportSuccess={onImported}
        />
      )}
    </>
  );
}

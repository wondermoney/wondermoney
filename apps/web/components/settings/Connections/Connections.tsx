"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import AccountAddModal from "@/components/account/AccountCreateModal";
import AccountAddOfflineModal from "@/components/account/AccountCreateOfflineModal";
import AccountAddSyncModal from "@/components/account/AccountCreateSyncModal";
import { Spinner } from "@/components/ui/Spinner";
import useRequisitions from "@/lib/api/user/useRequisitions";
import { useUser } from "@/lib/auth/user-context";

import { Heading, Text } from "../../ui/Typography";
import ConnectionsTable from "./ConnectionsTable";

export default function Connections() {
  const t = useTranslations();
  const user = useUser();
  const {
    data: requisitionsData,
    isLoading: isLoadingRequisitionData,
    error: requisitionsDataError,
  } = useRequisitions(user?.id, {
    enabled: !!user?.id,
  });
  const [isAddAccountModalOpen, setIsAddAccountModalOpen] = useState(false);
  const [isAddSyncAccountModalOpen, setIsAddSyncAccountModalOpen] =
    useState(false);
  const [isAddOfflineAccountModalOpen, setIsAddOfflineAccountModalOpen] =
    useState(false);

  return (
    <div className="divide-border divide-y">
      <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 px-4 py-16 sm:px-6 md:grid-cols-3 lg:px-8">
        <div>
          <Heading variant="h2">{t("bank-connections")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("bank-connections-description")}
          </Text>
        </div>
        <div className="bg-card rounded p-4 md:col-span-2">
          {isLoadingRequisitionData ? (
            <Spinner />
          ) : requisitionsDataError ? (
            <p>Error loading data</p>
          ) : requisitionsData?.requisitions &&
            requisitionsData.requisitions.length > 0 ? (
            <ConnectionsTable data={requisitionsData.requisitions} />
          ) : (
            <div className="flex flex-col items-start gap-2">
              <Text variant="mutedText" className="mt-1 text-sm">
                {t("no-connections")}
              </Text>
              <AccountAddModal
                isOpen={isAddAccountModalOpen}
                setOpen={setIsAddAccountModalOpen}
                onAddSyncAccountClick={() => setIsAddSyncAccountModalOpen(true)}
                onAddOfflineAccountClick={() =>
                  setIsAddOfflineAccountModalOpen(true)
                }
              />
              <AccountAddSyncModal
                isOpen={isAddSyncAccountModalOpen}
                setOpen={setIsAddSyncAccountModalOpen}
              />
              <AccountAddOfflineModal
                isOpen={isAddOfflineAccountModalOpen}
                closeModal={() => setIsAddOfflineAccountModalOpen(false)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

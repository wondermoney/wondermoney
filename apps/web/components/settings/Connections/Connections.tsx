"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import AccountAddModal from "@/components/account/AccountCreateModal";
import AccountAddOfflineModal from "@/components/account/AccountCreateOfflineModal";
import AccountAddSyncModal from "@/components/account/AccountCreateSyncModal";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/Spinner";
import useBankConnections, {
  simplefinConnections,
} from "@/lib/api/banking/useBankConnections";
import useRequisitions from "@/lib/api/user/useRequisitions";
import { useUser } from "@/lib/auth/user-context";

import { Heading, Text } from "../../ui/Typography";
import ConnectionsTable from "./ConnectionsTable";
import SimplefinConnectButton, {
  useSimplefinAvailable,
} from "./SimplefinConnectButton";
import SimplefinConnectionsTable from "./SimplefinConnectionsTable";

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
  // SimpleFIN connections are not requisitions: they come from the connection list, which
  // also polls while a first sync runs.
  const { data: connectionsData, isLoading: isLoadingConnections } =
    useBankConnections({ enabled: !!user?.id });
  const simplefin = simplefinConnections(connectionsData?.connections);
  const simplefinAvailable = useSimplefinAvailable();
  const requisitions = requisitionsData?.requisitions ?? [];
  const [isAddAccountModalOpen, setIsAddAccountModalOpen] = useState(false);
  const [isAddSyncAccountModalOpen, setIsAddSyncAccountModalOpen] =
    useState(false);
  const [isAddOfflineAccountModalOpen, setIsAddOfflineAccountModalOpen] =
    useState(false);

  const isLoading = isLoadingRequisitionData || isLoadingConnections;
  const hasNoConnections = requisitions.length === 0 && simplefin.length === 0;

  return (
    <div className="divide-border divide-y">
      <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 py-10 md:grid-cols-3">
        <div>
          <Heading variant="h2">{t("bank-connections")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("bank-connections-description")}
          </Text>
        </div>
        <div className="bg-card flex flex-col gap-6 rounded p-4 md:col-span-2">
          {isLoading ? (
            <Spinner />
          ) : requisitionsDataError ? (
            <p>Error loading data</p>
          ) : hasNoConnections ? (
            <div className="flex flex-col items-start gap-2">
              <Text variant="mutedText" className="mt-1 text-sm">
                {t("no-connections")}
              </Text>
              <Button onClick={() => setIsAddAccountModalOpen(true)}>
                <Plus className="size-4" aria-hidden="true" />
                {t("add-account")}
              </Button>
            </div>
          ) : (
            <>
              {requisitions.length > 0 ? (
                <ConnectionsTable data={requisitions} />
              ) : null}
              {simplefin.length > 0 ? (
                <section
                  aria-labelledby="simplefin-connections-title"
                  className="flex flex-col gap-2"
                >
                  <Heading
                    variant="h3"
                    id="simplefin-connections-title"
                    className="text-base"
                  >
                    {t("simplefin.connections-title")}
                  </Heading>
                  <SimplefinConnectionsTable connections={simplefin} />
                </section>
              ) : null}
              {simplefinAvailable ? (
                <div>
                  <SimplefinConnectButton />
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
      {/* Outside the empty state on purpose: connecting swaps it for the table as soon as the new
          connection is listed, and the dialogs (and the SimpleFIN one's first-sync watch) have to
          outlive that. */}
      <AccountAddModal
        isOpen={isAddAccountModalOpen}
        setOpen={setIsAddAccountModalOpen}
        onAddSyncAccountClick={() => setIsAddSyncAccountModalOpen(true)}
        onAddOfflineAccountClick={() => setIsAddOfflineAccountModalOpen(true)}
        trigger={false}
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
  );
}

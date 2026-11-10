"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { useInstanceName } from "@/components/instance/InstanceNameProvider";
import { useRouter } from "@/i18n/navigation";
import { useDataRestoreOverview } from "@/lib/api/user/useDataRestore";

import { Button } from "../ui/button";
import { Heading, Text } from "../ui/Typography";
import UserAccountDelete from "../user/UserAccountDelete";
import DataExport from "./DataExport";
import DataRestore, { shouldOfferRestore } from "./DataRestore";

export default function Privacy() {
  const t = useTranslations();
  const instanceName = useInstanceName();
  const router = useRouter();
  const { data: restoreOverview } = useDataRestoreOverview();

  const [isDeleteUserAccountModalOpen, setIsDeleteUserAccountModalOpen] =
    useState(false);

  return (
    <div className="divide-border divide-y">
      <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 py-10 md:grid-cols-3">
        <div>
          <Heading variant="h2">{t("privacy-data-sharing-title")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("privacy-data-sharing-description")}
          </Text>
        </div>

        <div className="flex items-start md:col-span-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/settings?tab=connections")}
          >
            {t("privacy-data-sharing-cta")}
          </Button>
        </div>
      </div>

      <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 py-10 md:grid-cols-3">
        <div>
          <Heading variant="h2">
            {t("privacy-account-visibility-title")}
          </Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("privacy-account-visibility-description")}
          </Text>
        </div>

        <div className="flex items-start md:col-span-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/accounts")}
          >
            {t("privacy-account-visibility-cta")}
          </Button>
        </div>
      </div>

      <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 py-10 md:grid-cols-3">
        <div>
          <Heading variant="h2">{t("privacy-data-export-title")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("privacy-data-export-description")}
          </Text>
        </div>

        <div className="flex items-start md:col-span-2">
          <DataExport />
        </div>
      </div>

      {shouldOfferRestore(restoreOverview) ? (
        <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 py-10 md:grid-cols-3">
          <div>
            <Heading variant="h2">{t("privacy-data-restore-title")}</Heading>
            <Text variant="lead" className="mt-1 text-sm">
              {t("privacy-data-restore-description")}
            </Text>
          </div>

          <div className="flex items-start md:col-span-2">
            <DataRestore
              restoredAction={
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push("/accounts")}
                >
                  {t("privacy-data-restore-restored-cta")}
                </Button>
              }
            />
          </div>
        </div>
      ) : null}

      <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 py-10 md:grid-cols-3">
        <div>
          <Heading variant="h2">
            {t("delete-wondermoney-account", { instanceName })}
          </Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("delete-wondermoney-account-description", { instanceName })}
          </Text>
        </div>

        <div className="flex items-start md:col-span-2">
          <Button
            type="button"
            variant="destructive"
            onClick={() => setIsDeleteUserAccountModalOpen(true)}
          >
            {t("delete-wondermoney-account", { instanceName })}
          </Button>
          <UserAccountDelete
            isOpen={isDeleteUserAccountModalOpen}
            closeModal={() => setIsDeleteUserAccountModalOpen(false)}
          />
        </div>
      </div>
    </div>
  );
}

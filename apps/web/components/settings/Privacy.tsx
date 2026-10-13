"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { useRouter } from "@/i18n/navigation";

import { Button } from "../ui/button";
import { Heading, Text } from "../ui/Typography";
import UserAccountDelete from "../user/UserAccountDelete";

export default function Privacy() {
  const t = useTranslations();
  const router = useRouter();

  const [isDeleteUserAccountModalOpen, setIsDeleteUserAccountModalOpen] =
    useState(false);

  return (
    <div className="divide-border divide-y">
      <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 px-4 py-16 sm:px-6 md:grid-cols-3 lg:px-8">
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

      <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 px-4 py-16 sm:px-6 md:grid-cols-3 lg:px-8">
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

      <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 px-4 py-16 sm:px-6 md:grid-cols-3 lg:px-8">
        <div>
          <Heading variant="h2">{t("privacy-data-export-title")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("privacy-data-export-description")}
          </Text>
        </div>

        <div className="flex items-start md:col-span-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/reports")}
          >
            {t("privacy-data-export-cta")}
          </Button>
        </div>
      </div>

      <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 px-4 py-16 sm:px-6 md:grid-cols-3 lg:px-8">
        <div>
          <Heading variant="h2">{t("delete-wondermoney-account")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("delete-wondermoney-account-description")}
          </Text>
        </div>

        <div className="flex items-start md:col-span-2">
          <Button
            type="button"
            variant="destructive"
            onClick={() => setIsDeleteUserAccountModalOpen(true)}
          >
            {t("delete-wondermoney-account")}
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

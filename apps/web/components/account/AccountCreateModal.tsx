"use client";

import { KeyRound, Link as LinkIcon, Plus, Unlink } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { Link } from "@/components/ui/Link";
import { Spinner } from "@/components/ui/Spinner";
import { Heading, Text } from "@/components/ui/Typography";
import useEnableBankingCredential from "@/lib/api/user/useEnableBankingCredential";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import OpenBankingNotice from "./OpenBankingNotice";

interface AccountAddModalProps {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  onAddSyncAccountClick: () => void;
  onAddOfflineAccountClick: () => void;
  trigger?: false | React.ReactNode;
}

const AccountAddModal: React.FC<AccountAddModalProps> = ({
  isOpen,
  setOpen,
  onAddSyncAccountClick,
  onAddOfflineAccountClick,
  trigger,
}) => {
  const t = useTranslations();
  const linkedAccountsLink = t("faq-linked-accounts-link");
  const { data: enableBankingCredential, isLoading: credentialLoading } =
    useEnableBankingCredential();
  const credentialRequired =
    !credentialLoading && enableBankingCredential?.status !== "active";

  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={setOpen}
      title={t("add-account")}
      trigger={
        trigger === false
          ? undefined
          : (trigger ?? (
              <Button className="gap-2" size="sm">
                <Plus className="size-4" />
                {t("add-account")}
              </Button>
            ))
      }
    >
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-2 px-2 md:grid-cols-2 md:gap-6">
          {credentialLoading ? (
            <div className="border-border bg-muted/40 relative flex h-full flex-1 flex-col items-center justify-center gap-4 rounded-lg border p-4">
              <Spinner />
            </div>
          ) : credentialRequired ? (
            <div
              aria-disabled="true"
              className="border-border bg-muted/40 text-muted-foreground relative flex h-full flex-1 flex-col items-center justify-start gap-4 rounded-lg border p-4 whitespace-normal"
            >
              <div className="bg-background text-muted-foreground rounded-full p-2">
                <KeyRound />
              </div>
              <Heading variant="h3" className="text-foreground text-lg">
                {t("bankProviderCredentialRequired.title")}
              </Heading>
              <Text variant="smallText" className="text-muted-foreground">
                {t("bankProviderCredentialRequired.body")}
              </Text>
              <Link
                href="/settings?tab=bank-provider"
                className="text-primary text-xs font-semibold underline underline-offset-2"
              >
                {t("bankProviderCredentialRequired.cta")}
              </Link>
            </div>
          ) : (
            <Button
              className="relative flex h-full flex-1 flex-col items-center justify-start gap-4 p-4 whitespace-normal"
              onClick={(e) => {
                e.stopPropagation();
                onAddSyncAccountClick();
              }}
            >
              <div className="bg-background text-primary rounded-full p-2">
                <LinkIcon />
              </div>
              <Heading variant="h3" className="text-primary-foreground text-lg">
                {t("linked")}
              </Heading>
              <Text variant="smallText" className="text-primary-foreground">
                {t("add-linked-account-description")}
              </Text>
            </Button>
          )}
          <Button
            className="flex h-full flex-1 flex-col items-center justify-start gap-4 p-4 whitespace-normal"
            onClick={(e) => {
              e.stopPropagation();
              onAddOfflineAccountClick();
            }}
            variant="outline"
          >
            <div className="bg-primary rounded-full p-2 text-white">
              <Unlink />
            </div>
            <Heading variant="h3" className="text-primary text-lg">
              {t("unlinked")}
            </Heading>
            <Text variant="smallText" className="text-primary">
              {t("add-unlinked-account-description")}
            </Text>
          </Button>
        </div>
        <Accordion
          type="single"
          collapsible
          className="bg-background/80 max-h-[200px] overflow-y-auto rounded-lg border px-3"
        >
          <AccordionItem value="open-banking-info" className="border-b-0">
            <AccordionTrigger className="text-left text-sm font-semibold">
              {t("faq-open-banking-title")}
            </AccordionTrigger>
            <AccordionContent className="text-foreground text-left">
              <div className="space-y-3">
                <OpenBankingNotice />
                <a
                  className="text-sm font-semibold underline underline-offset-2"
                  href={linkedAccountsLink}
                  target="_blank"
                >
                  {t("faq-account-how")}
                </a>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </DrawerDialog>
  );
};

export default AccountAddModal;

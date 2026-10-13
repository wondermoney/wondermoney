"use client";

import { KeyRound, Link as LinkIcon, Plus, Unlink } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { Link } from "@/components/ui/Link";
import { Spinner } from "@/components/ui/Spinner";
import { Heading, Text } from "@/components/ui/Typography";
import useEnableBankingCredential from "@/lib/api/user/useEnableBankingCredential";
import { isBankConnectionsPaused } from "@/lib/utils/bank-connections-paused";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";

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
  const bopLink = t("faq-bop-link");
  const termsLink = t("faq-terms-link");
  const privacyLink = t("faq-privacy-link");
  const linkedAccountsLink = t("faq-linked-accounts-link");
  const bankConnectionsPaused = isBankConnectionsPaused();
  // Gating order: paused (unchanged, first priority) takes precedence over the
  // BYOK credential check, which only runs once bank-sync isn't already
  // paused globally.
  const { data: enableBankingCredential, isLoading: credentialLoading } =
    useEnableBankingCredential({ enabled: !bankConnectionsPaused });
  const credentialRequired =
    !bankConnectionsPaused &&
    !credentialLoading &&
    enableBankingCredential?.status !== "active";

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
          {bankConnectionsPaused ? (
            <div
              aria-disabled="true"
              className="border-border bg-muted/40 text-muted-foreground relative flex h-full flex-1 flex-col items-center justify-start gap-4 rounded-lg border p-4 whitespace-normal"
            >
              <div className="bg-background text-muted-foreground rounded-full p-2">
                <LinkIcon />
              </div>
              <Heading variant="h3" className="text-foreground text-lg">
                {t("bankConnectionsPaused.title")}
              </Heading>
              <Text variant="smallText" className="text-muted-foreground">
                {t("bankConnectionsPaused.body")}
              </Text>
              <Link
                href="/faq"
                className="text-primary text-xs font-semibold underline underline-offset-2"
              >
                {t("bankConnectionsPaused.cta")}
              </Link>
            </div>
          ) : credentialLoading ? (
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
              <Heading
                variant="h3"
                className="text-primary-foreground text-lg"
              >
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
                <Text variant="smallText" className="text-foreground block">
                  {t.rich("faq-open-banking-body-1", {
                    bopLink: (chunks) => (
                      <a
                        href={bopLink}
                        target="_blank"
                        className="text-primary font-semibold underline-offset-2 hover:underline"
                        rel="noreferrer"
                      >
                        {chunks}
                      </a>
                    ),
                  })}
                </Text>
                <Text variant="smallText" className="text-foreground block">
                  {t.rich("faq-open-banking-body-2", {
                    termsLink: (chunks) => (
                      <a
                        href={termsLink}
                        target="_blank"
                        className="text-primary font-semibold underline-offset-2 hover:underline"
                        rel="noreferrer"
                      >
                        {chunks}
                      </a>
                    ),
                    privacyLink: (chunks) => (
                      <a
                        href={privacyLink}
                        target="_blank"
                        className="text-primary font-semibold underline-offset-2 hover:underline"
                        rel="noreferrer"
                      >
                        {chunks}
                      </a>
                    ),
                  })}
                </Text>
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

"use client";

import { useTranslations } from "next-intl";
import React, { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import useAccounts from "@/lib/api/account/useAccounts";
import {
  getPortfolioLinkHolderName,
  isPortfolioLinkRefusal,
} from "@/lib/api/errors";
import type { Portfolio } from "@/lib/api/portfolio/usePortfolio";
import useUpdatePortfolio from "@/lib/api/portfolio/useUpdatePortfolio";
import {
  draftFromLink,
  linkChanged,
  linkInputFromDraft,
} from "@/lib/portfolio/account-link";

import { PortfolioAccountLinkFields } from "./PortfolioAccountLinkFields";

interface PortfolioSettingsModalProps {
  isOpen: boolean;
  closeModal: () => void;
  portfolio: Portfolio;
}

const PortfolioSettingsModal: React.FC<PortfolioSettingsModalProps> = ({
  isOpen,
  closeModal,
  portfolio,
}) => {
  const t = useTranslations();
  const updatePortfolio = useUpdatePortfolio();
  const { data: accountsData } = useAccounts();

  const [name, setName] = useState(portfolio.name);
  const [description, setDescription] = useState(portfolio.description ?? "");
  const [link, setLink] = useState(draftFromLink(portfolio.accountLink));

  // Reload the fields from the portfolio when the modal opens (or the
  // portfolio changes while open), adjusting during render.
  const [syncedFrom, setSyncedFrom] = useState({ isOpen, portfolio });
  if (syncedFrom.isOpen !== isOpen || syncedFrom.portfolio !== portfolio) {
    setSyncedFrom({ isOpen, portfolio });
    if (isOpen) {
      setName(portfolio.name);
      setDescription(portfolio.description ?? "");
      setLink(draftFromLink(portfolio.accountLink));
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updatePortfolio.mutateAsync({
        portfolioId: portfolio.portfolioKey,
        name,
        description: description || null,
        // Sent only when changed: a link this member cannot see is never touched.
        ...(linkChanged(portfolio.accountLink, link)
          ? { accountLink: linkInputFromDraft(link) }
          : {}),
      });
      toast.success(t("save"));
      closeModal();
    } catch (error) {
      const holder = getPortfolioLinkHolderName(error);
      toast.error(
        holder
          ? t("portfolioAccountLink.already-linked-by", { name: holder })
          : isPortfolioLinkRefusal(error)
            ? t("portfolioAccountLink.managed-by-partner")
            : t("server-error"),
      );
    }
  };

  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) closeModal();
      }}
      title={t("portfolio-settings")}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="portfolio-name">{t("name")}</Label>
          <Input
            id="portfolio-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="portfolio-description">{t("description")}</Label>
          <Input
            id="portfolio-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <PortfolioAccountLinkFields
          accounts={accountsData?.accounts ?? []}
          value={link}
          onChange={setLink}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={closeModal}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={updatePortfolio.isPending}>
            {t("save")}
          </Button>
        </div>
      </form>
    </DrawerDialog>
  );
};

export default PortfolioSettingsModal;

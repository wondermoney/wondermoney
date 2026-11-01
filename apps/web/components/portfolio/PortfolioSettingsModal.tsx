"use client";

import { useTranslations } from "next-intl";
import React, { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import type { Portfolio } from "@/lib/api/portfolio/usePortfolio";
import useUpdatePortfolio from "@/lib/api/portfolio/useUpdatePortfolio";

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

  const [name, setName] = useState(portfolio.name);
  const [description, setDescription] = useState(portfolio.description ?? "");

  // Reload the fields from the portfolio when the modal opens (or the
  // portfolio changes while open), adjusting during render.
  const [syncedFrom, setSyncedFrom] = useState({ isOpen, portfolio });
  if (syncedFrom.isOpen !== isOpen || syncedFrom.portfolio !== portfolio) {
    setSyncedFrom({ isOpen, portfolio });
    if (isOpen) {
      setName(portfolio.name);
      setDescription(portfolio.description ?? "");
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updatePortfolio.mutateAsync({
        portfolioId: portfolio.portfolioKey,
        name,
        description: description || null,
      });
      toast.success(t("save"));
      closeModal();
    } catch {
      toast.error(t("server-error"));
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

"use client";

import { useTranslations } from "next-intl";
import React, { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/Typography";
import useAccounts from "@/lib/api/account/useAccounts";
import {
  getPortfolioLinkHolderName,
  isPortfolioLinkRefusal,
} from "@/lib/api/errors";
import type {
  Portfolio,
  PortfolioCostBasisMethod,
} from "@/lib/api/portfolio/usePortfolio";
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
  const [costBasisMethod, setCostBasisMethod] = useState<PortfolioCostBasisMethod>(
    portfolio.costBasisMethod ?? "FIFO",
  );
  const [excluded, setExcluded] = useState(portfolio.excluded ?? false);

  // Reload the fields from the portfolio when the modal opens (or the
  // portfolio changes while open), adjusting during render.
  const [syncedFrom, setSyncedFrom] = useState({ isOpen, portfolio });
  if (syncedFrom.isOpen !== isOpen || syncedFrom.portfolio !== portfolio) {
    setSyncedFrom({ isOpen, portfolio });
    if (isOpen) {
      setName(portfolio.name);
      setDescription(portfolio.description ?? "");
      setLink(draftFromLink(portfolio.accountLink));
      setCostBasisMethod(portfolio.costBasisMethod ?? "FIFO");
      setExcluded(portfolio.excluded ?? false);
    }
  }

  const costBasisMethodChanged =
    (portfolio.costBasisMethod ?? "FIFO") !== costBasisMethod;
  const methodOptions: Array<{
    hint: string;
    label: string;
    method: PortfolioCostBasisMethod;
  }> = [
    {
      hint: t("cost-basis-fifo-hint"),
      label: t("cost-basis-fifo"),
      method: "FIFO",
    },
    {
      hint: t("cost-basis-average-hint"),
      label: t("cost-basis-average"),
      method: "AVERAGE",
    },
  ];

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
        ...(costBasisMethodChanged ? { costBasisMethod } : {}),
        ...(excluded !== (portfolio.excluded ?? false) ? { excluded } : {}),
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

        <div className="flex items-start gap-3">
          <Switch
            id="portfolio-excluded"
            checked={excluded}
            onCheckedChange={setExcluded}
            aria-describedby="portfolio-excluded-hint"
          />
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="portfolio-excluded">
              {t("portfolio-excluded")}
            </Label>
            <Text
              id="portfolio-excluded-hint"
              variant="smallText"
              className="text-muted-foreground"
            >
              {t("portfolio-excluded-hint")}
            </Text>
          </div>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">
            {t("cost-basis-method")}
          </legend>
          {methodOptions.map((option) => (
            <label
              key={option.method}
              className="border-border has-[:checked]:border-foreground flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 text-sm"
            >
              <input
                type="radio"
                name="cost-basis-method"
                value={option.method}
                checked={costBasisMethod === option.method}
                onChange={() => setCostBasisMethod(option.method)}
                className="mt-0.5"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{option.label}</span>
                <span className="text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          ))}
          <Text variant="smallText" className="text-muted-foreground">
            {t("cost-basis-method-hint")}
          </Text>
        </fieldset>

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

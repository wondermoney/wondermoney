"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { PortfolioAccountLinkFields } from "@/components/portfolio/PortfolioAccountLinkFields";
import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { Label } from "@/components/ui/Label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import useAccounts from "@/lib/api/account/useAccounts";
import {
  getPortfolioLinkHolderName,
  isPortfolioLinkRefusal,
} from "@/lib/api/errors";
import usePortfolios from "@/lib/api/portfolio/usePortfolios";
import useUpdatePortfolio from "@/lib/api/portfolio/useUpdatePortfolio";
import {
  draftFromLink,
  linkInputFromDraft,
} from "@/lib/portfolio/account-link";
import { useDismissibleActivation } from "@/lib/utils/useDismissibleActivation";

const DISMISSAL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * "Is this the same money?": shown on net worth when the viewer can see an investment account no
 * portfolio is linked to and the household has a portfolio with no link (the API decides,
 * `suggestPortfolioLink`). Amounts are not compared.
 * Dismissing it hides it on this browser for a year.
 */
export function PortfolioLinkSuggestion({ suggested }: { suggested: boolean }) {
  const t = useTranslations("portfolioAccountLink");
  const tCommon = useTranslations();
  const { isDismissed, dismiss } = useDismissibleActivation(
    "net-worth-portfolio-link-suggestion",
    DISMISSAL_MS,
  );
  const [open, setOpen] = useState(false);
  const { data: accountsData } = useAccounts();
  const { data: portfoliosData } = usePortfolios({ enabled: suggested });
  const updatePortfolio = useUpdatePortfolio();
  const [portfolioId, setPortfolioId] = useState<number | null>(null);
  const [link, setLink] = useState(draftFromLink(null));

  if (!suggested || isDismissed) return null;

  const unlinked = (portfoliosData?.portfolios ?? []).filter(
    (portfolio) => !portfolio.accountLink,
  );
  const accountLink = linkInputFromDraft(link);

  const save = async () => {
    if (portfolioId === null || !accountLink) return;
    try {
      await updatePortfolio.mutateAsync({ portfolioId, accountLink });
      toast.success(t("saved"));
      setOpen(false);
    } catch (error) {
      const holder = getPortfolioLinkHolderName(error);
      toast.error(
        holder
          ? t("already-linked-by", { name: holder })
          : isPortfolioLinkRefusal(error)
            ? t("managed-by-partner")
            : tCommon("server-error"),
      );
    }
  };

  return (
    <aside
      aria-labelledby="portfolio-link-suggestion"
      className="border-border mb-6 flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h3 id="portfolio-link-suggestion" className="text-sm font-semibold">
          {t("suggestion-title")}
        </h3>
        <p className="text-muted-foreground text-sm">{t("suggestion-body")}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
          {t("dismiss")}
        </Button>
        <DrawerDialog
          open={open}
          onOpenChange={setOpen}
          trigger={
            <Button type="button" variant="outline" size="sm">
              {t("suggestion-link")}
            </Button>
          }
          title={t("dialog-title")}
          footer={
            <Button
              type="button"
              onClick={() => void save()}
              loading={updatePortfolio.isPending}
              disabled={
                portfolioId === null ||
                !accountLink ||
                updatePortfolio.isPending
              }
            >
              {tCommon("save")}
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="portfolio-link-suggestion-portfolio">
                {t("portfolio-label")}
              </Label>
              <Select
                value={portfolioId === null ? undefined : String(portfolioId)}
                onValueChange={(next) => setPortfolioId(Number(next))}
              >
                <SelectTrigger
                  id="portfolio-link-suggestion-portfolio"
                  className="w-full"
                >
                  <SelectValue placeholder={t("select-portfolio")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {unlinked.map((portfolio) => (
                      <SelectItem
                        key={portfolio.portfolioKey}
                        value={String(portfolio.portfolioKey)}
                      >
                        {portfolio.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <PortfolioAccountLinkFields
              accounts={accountsData?.accounts ?? []}
              value={link}
              onChange={setLink}
            />
          </div>
        </DrawerDialog>
      </div>
    </aside>
  );
}

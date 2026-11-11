"use client";

import { Bookmark, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import useTransactionTemplates, {
  type TransactionTemplate,
} from "@/lib/api/transaction-template/useTransactionTemplates";

/**
 * The saved entries of the person using the add form. Choosing one hands it to the form to
 * fill; nothing is created until the person reviews and saves. The last item starts a new
 * template from scratch.
 */
export function TransactionTemplatesMenu({
  disabled,
  onCreate,
  onSelect,
}: {
  disabled?: boolean;
  onCreate: () => void;
  onSelect: (template: TransactionTemplate) => void;
}) {
  const t = useTranslations();
  const { data, isError, isLoading } = useTransactionTemplates();
  const templates = data?.templates ?? [];

  // A server too old to have templates answers 404: the control simply stays out of the way.
  if (isLoading || isError) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="secondary" disabled={disabled}>
          <Bookmark className="size-4" />
          {t("transactionTemplates.menu")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        <DropdownMenuLabel>{t("transactionTemplates.menu")}</DropdownMenuLabel>
        {templates.map((template) => (
          <DropdownMenuItem
            key={template.transactionTemplateKey}
            onSelect={() => onSelect(template)}
          >
            <span className="truncate">{template.name}</span>
          </DropdownMenuItem>
        ))}
        {templates.length > 0 ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem onSelect={onCreate}>
          <Plus className="size-4" />
          {t("transactionTemplates.new-template")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

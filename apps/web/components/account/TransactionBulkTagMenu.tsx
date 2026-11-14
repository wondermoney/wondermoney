"use client";

import { Tag as TagIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { TagChip } from "@/components/tags/TagChip";
import type { Tag } from "@/lib/api/tag/useTags";
import useTags from "@/lib/api/tag/useTags";

import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

interface TransactionBulkTagMenuProps {
  /**
   * Tag keys some selected row carries, offered under "Remove tag". `null`
   * when the selection is every matching row, whose tags are not loaded: then
   * every household tag is offered.
   */
  carriedTagKeys: ReadonlySet<number> | null;
  disabled?: boolean;
  onAdd: (tag: Tag) => void;
  onRemove: (tag: Tag) => void;
}

/**
 * "Tag" in the bulk bar: put one of the household's tags on every selected
 * row, or take one off. Tags are created in Settings → Tags or while editing a
 * transaction; this menu only applies existing ones.
 */
export function TransactionBulkTagMenu({
  carriedTagKeys,
  disabled,
  onAdd,
  onRemove,
}: TransactionBulkTagMenuProps) {
  const t = useTranslations("transactionBulk");
  const { data, isLoading } = useTags();
  const tags = data?.tags ?? [];
  const removable =
    carriedTagKeys === null
      ? tags
      : tags.filter((tag) => carriedTagKeys.has(tag.tagKey));

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="text-foreground"
          disabled={disabled}
          loading={isLoading}
        >
          <TagIcon className="mr-2 size-4" />
          {t("tag")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        <DropdownMenuLabel>{t("add-tag")}</DropdownMenuLabel>
        {tags.length === 0 ? (
          <DropdownMenuItem disabled>{t("no-tags")}</DropdownMenuItem>
        ) : (
          tags.map((tag) => (
            <DropdownMenuItem
              key={`add-${tag.tagKey}`}
              aria-label={t("add-tag-named", { name: tag.name })}
              onSelect={() => onAdd(tag)}
            >
              <TagChip tag={tag} />
            </DropdownMenuItem>
          ))
        )}
        {removable.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("remove-tag")}</DropdownMenuLabel>
            {removable.map((tag) => (
              <DropdownMenuItem
                key={`remove-${tag.tagKey}`}
                aria-label={t("remove-tag-named", { name: tag.name })}
                onSelect={() => onRemove(tag)}
              >
                <TagChip tag={tag} />
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

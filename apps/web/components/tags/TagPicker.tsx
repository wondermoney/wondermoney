"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getApiErrorCode, isDemoReadOnlyError } from "@/lib/api/errors";
import useTags, {
  getTags,
  MAX_TAGS_PER_TRANSACTION,
  type Tag,
  tagsKey,
  useCreateTag,
} from "@/lib/api/tag/useTags";
import { cn } from "@/lib/utils";

import { TagChipList } from "./TagChip";

/** Case- and space-insensitive, the way the API decides two names are the same tag. */
export const sameTagName = (a: string, b: string) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/**
 * Pick any number of household tags, and create one inline by typing a name no
 * tag has yet. Selection is controlled: `value` is the chosen tag keys.
 *
 * A name that clashes with an existing tag (another member may have just made
 * it) selects that tag instead of failing.
 */
export function TagPicker({
  value,
  onChange,
  disabled,
  id,
  className,
}: {
  value: number[];
  onChange: (tagKeys: number[]) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const t = useTranslations("transactionTags");
  const tRoot = useTranslations();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data, isLoading, isError } = useTags();
  const createTag = useCreateTag();

  const tags = data?.tags ?? [];
  const selected = value
    .map((key) => tags.find((tag) => tag.tagKey === key))
    .filter((tag): tag is Tag => tag !== undefined);
  const atLimit = value.length >= MAX_TAGS_PER_TRANSACTION;
  const trimmed = query.trim();
  const canCreate =
    trimmed.length > 0 &&
    trimmed.length <= 64 &&
    !tags.some((tag) => sameTagName(tag.name, trimmed));

  const toggle = (tagKey: number) => {
    if (value.includes(tagKey)) onChange(value.filter((key) => key !== tagKey));
    else if (!atLimit) onChange([...value, tagKey]);
  };

  const select = (tag: Tag) => {
    if (!value.includes(tag.tagKey) && !atLimit)
      onChange([...value, tag.tagKey]);
  };

  const create = async () => {
    if (!canCreate || createTag.isPending) return;
    try {
      const tag = await createTag.mutateAsync({ name: trimmed });
      queryClient.setQueryData<{ tags: Tag[] }>(tagsKey, (current) => ({
        tags: [...(current?.tags ?? []), tag],
      }));
      void queryClient.invalidateQueries({ queryKey: tagsKey });
      select(tag);
      setQuery("");
    } catch (error) {
      if (getApiErrorCode(error) === "tag_name_taken") {
        const fresh = await queryClient.fetchQuery({
          queryKey: tagsKey,
          queryFn: () => getTags(),
          staleTime: 0,
        });
        const existing = fresh.tags.find((tag) =>
          sameTagName(tag.name, trimmed),
        );
        if (existing) {
          select(existing);
          setQuery("");
          return;
        }
      }
      if (isDemoReadOnlyError(error)) {
        toast.error(tRoot("demo-read-only-title"), {
          description: tRoot("demo-read-only-description"),
        });
        return;
      }
      toast.error(t("create-error"));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="input"
          role="combobox"
          aria-expanded={open}
          aria-label={
            selected.length > 0
              ? t("picker-label-selected", {
                  names: selected.map((tag) => tag.name).join(", "),
                })
              : t("picker-label")
          }
          disabled={disabled}
          className={cn(
            "h-auto min-h-9 w-full justify-between py-1.5",
            className,
          )}
        >
          {selected.length > 0 ? (
            <TagChipList tags={selected} max={6} />
          ) : (
            <span className="text-muted-foreground">{t("placeholder")}</span>
          )}
          <ChevronsUpDown className="text-muted-foreground ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-110 w-(--radix-popover-trigger-width) min-w-64 p-0"
        align="start"
      >
        <Command>
          <CommandInput
            placeholder={t("search-or-create")}
            value={query}
            onValueChange={setQuery}
            maxLength={64}
          />
          <CommandList>
            {isLoading ? (
              <p className="text-muted-foreground p-3 text-sm">
                {t("loading")}
              </p>
            ) : null}
            {isError ? (
              <p role="alert" className="text-muted-foreground p-3 text-sm">
                {t("load-error")}
              </p>
            ) : null}
            {!isLoading && !isError ? (
              <CommandEmpty className="text-muted-foreground p-3 text-sm">
                {trimmed ? t("no-match") : t("empty")}
              </CommandEmpty>
            ) : null}
            {tags.length > 0 ? (
              <CommandGroup>
                {tags.map((tag) => {
                  const checked = value.includes(tag.tagKey);
                  return (
                    <CommandItem
                      key={tag.tagKey}
                      value={`${tag.name}__${tag.tagKey}`}
                      keywords={[tag.name]}
                      disabled={!checked && atLimit}
                      onSelect={() => toggle(tag.tagKey)}
                      data-checked={checked}
                    >
                      <Check
                        className={cn(
                          "mr-2 size-4",
                          checked ? "opacity-100" : "opacity-0",
                        )}
                        aria-hidden="true"
                      />
                      <span
                        aria-hidden="true"
                        className="ring-foreground/20 mr-2 size-2 shrink-0 rounded-full ring-1"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="truncate">{tag.name}</span>
                      {checked ? (
                        <span className="sr-only">{t("selected")}</span>
                      ) : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
            {canCreate ? (
              <CommandGroup forceMount>
                <CommandItem
                  forceMount
                  value={`__create__${trimmed}`}
                  disabled={createTag.isPending || atLimit}
                  onSelect={() => void create()}
                >
                  <Plus className="mr-2 size-4" aria-hidden="true" />
                  <span className="truncate">
                    {t("create", { name: trimmed })}
                  </span>
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
          {atLimit ? (
            <p className="text-muted-foreground border-t p-2 text-xs">
              {t("limit", { max: MAX_TAGS_PER_TRANSACTION })}
            </p>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

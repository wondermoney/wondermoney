"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { toast } from "sonner";

import { TagChip } from "@/components/tags/TagChip";
import { sameTagName } from "@/components/tags/TagPicker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getApiErrorCode, isDemoReadOnlyError } from "@/lib/api/errors";
import useTags, {
  DEFAULT_TAG_COLOR,
  invalidateTags,
  type Tag,
  useCreateTag,
  useDeleteTag,
  useEditTag,
} from "@/lib/api/tag/useTags";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/Label";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Spinner } from "../ui/Spinner";
import { Heading, Text } from "../ui/Typography";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const TAG_NAME_MAX_LENGTH = 64;

/** A colour swatch that opens a picker, the same control the category form uses. */
function ColorField({
  id,
  value,
  onChange,
  label,
}: {
  id: string;
  value: string;
  onChange: (color: string) => void;
  label: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="input"
          className="w-full justify-start font-mono sm:w-36"
          aria-label={`${label}, ${value}`}
        >
          <span
            aria-hidden="true"
            className="ring-foreground/20 mr-2 size-4 shrink-0 rounded-full ring-1"
            style={{
              backgroundColor: HEX_COLOR.test(value) ? value : undefined,
            }}
          />
          {value}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <HexColorPicker color={value} onChange={onChange} />
        <Input
          className="mt-2 text-center font-mono"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="#94a3b8"
          aria-label={label}
          maxLength={7}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Name and colour, validated the way the API validates them. */
function TagFields({
  idPrefix,
  name,
  color,
  onNameChange,
  onColorChange,
  error,
}: {
  idPrefix: string;
  name: string;
  color: string;
  onNameChange: (name: string) => void;
  onColorChange: (color: string) => void;
  error: string | null;
}) {
  const t = useTranslations("transactionTags");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor={`${idPrefix}-name`}>{t("name")}</Label>
          <Input
            id={`${idPrefix}-name`}
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            maxLength={TAG_NAME_MAX_LENGTH}
            aria-invalid={error !== null}
            aria-describedby={error ? `${idPrefix}-error` : undefined}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-color`}>{t("color")}</Label>
          <ColorField
            id={`${idPrefix}-color`}
            value={color}
            onChange={onColorChange}
            label={t("color")}
          />
        </div>
      </div>
      {error ? (
        <p
          id={`${idPrefix}-error`}
          role="alert"
          className="text-destructive-text text-sm"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Settings → Tags: the household's tags, renamed, recoloured or deleted in
 * place, and a form to add one. Both members of a household edit the same list.
 */
export default function Tags() {
  const t = useTranslations("transactionTags");
  const tRoot = useTranslations();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useTags();
  const createTag = useCreateTag();
  const editTag = useEditTag();
  const deleteTag = useDeleteTag();

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(DEFAULT_TAG_COLOR);
  const [newError, setNewError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Tag | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(DEFAULT_TAG_COLOR);
  const [editError, setEditError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState<Tag | null>(null);

  const tags = data?.tags ?? [];

  /** The message for a name or colour the API would refuse, or `null`. */
  const validate = (name: string, color: string, exceptTagKey?: number) => {
    if (name.trim().length === 0) return t("errors.name-required");
    if (!HEX_COLOR.test(color)) return t("errors.color-invalid");
    if (
      tags.some(
        (tag) => tag.tagKey !== exceptTagKey && sameTagName(tag.name, name),
      )
    ) {
      return t("errors.name-taken");
    }
    return null;
  };

  /** A refused write's message; `null` when a toast already said it. */
  const describeError = (error: unknown) => {
    if (getApiErrorCode(error) === "tag_name_taken")
      return t("errors.name-taken");
    if (isDemoReadOnlyError(error)) {
      toast.error(tRoot("demo-read-only-title"), {
        description: tRoot("demo-read-only-description"),
      });
      return null;
    }
    toast.error(t("save-error"));
    return null;
  };

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validate(newName, newColor);
    setNewError(problem);
    if (problem) return;
    try {
      await createTag.mutateAsync({
        name: newName.trim(),
        color: newColor.toLowerCase(),
      });
      await invalidateTags(queryClient);
      toast.success(t("created"));
      setNewName("");
      setNewColor(DEFAULT_TAG_COLOR);
    } catch (error) {
      setNewError(describeError(error));
    }
  };

  const startEditing = (tag: Tag) => {
    setEditing(tag);
    setEditName(tag.name);
    setEditColor(tag.color);
    setEditError(null);
  };

  const onSaveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const problem = validate(editName, editColor, editing.tagKey);
    setEditError(problem);
    if (problem) return;
    const name = editName.trim();
    const color = editColor.toLowerCase();
    try {
      await editTag.mutateAsync({
        tagKey: editing.tagKey,
        ...(name !== editing.name ? { name } : {}),
        ...(color !== editing.color ? { color } : {}),
      });
      await invalidateTags(queryClient);
      toast.success(t("updated"));
      setEditing(null);
    } catch (error) {
      setEditError(describeError(error));
    }
  };

  const onConfirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteTag.mutateAsync(deleting.tagKey);
      await invalidateTags(queryClient);
      toast.success(t("deleted"));
    } catch (error) {
      describeError(error);
    } finally {
      setDeleting(null);
    }
  };

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div>
        <Heading variant="h2">{t("title")}</Heading>
        <Text variant="lead" className="mt-1 text-sm">
          {t("description")}
        </Text>
      </div>

      {isError ? (
        <div role="alert" className="flex items-center gap-3">
          <Text className="text-sm">{t("load-error")}</Text>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {tRoot("retry")}
          </Button>
        </div>
      ) : tags.length === 0 ? (
        <Text className="text-muted-foreground text-sm">
          {t("empty-settings")}
        </Text>
      ) : (
        <ul className="divide-border border-border divide-y rounded-md border">
          {tags.map((tag) =>
            editing?.tagKey === tag.tagKey ? (
              <li key={tag.tagKey} className="p-3">
                <form onSubmit={onSaveEdit} className="flex flex-col gap-3">
                  <TagFields
                    idPrefix={`edit-tag-${tag.tagKey}`}
                    name={editName}
                    color={editColor}
                    onNameChange={setEditName}
                    onColorChange={setEditColor}
                    error={editError}
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" loading={editTag.isPending}>
                      {tRoot("save")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(null)}
                    >
                      {tRoot("cancel")}
                    </Button>
                  </div>
                </form>
              </li>
            ) : (
              <li
                key={tag.tagKey}
                className="flex min-h-11 items-center justify-between gap-3 px-3 py-2"
              >
                <TagChip tag={tag} className="max-w-[32ch]" />
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("edit-named", { name: tag.name })}
                    onClick={() => startEditing(tag)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("delete-named", { name: tag.name })}
                    onClick={() => setDeleting(tag)}
                  >
                    <Trash className="size-4" />
                  </Button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      <form onSubmit={onCreate} className="space-y-4">
        <Heading variant="h4">{t("add")}</Heading>
        <TagFields
          idPrefix="new-tag"
          name={newName}
          color={newColor}
          onNameChange={setNewName}
          onColorChange={setNewColor}
          error={newError}
        />
        <Button type="submit" loading={createTag.isPending}>
          {t("add")}
        </Button>
      </form>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("delete-title", { name: deleting?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("delete-description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tRoot("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onConfirmDelete()}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

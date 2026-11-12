"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

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
import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/Label";
import { Heading, Text } from "@/components/ui/Typography";
import {
  browserSupportsPasskeys,
  isPasskeyCancelled,
  isSessionNotFresh,
  type Passkey,
  passkeyLabel,
  useAddPasskey,
  useDeletePasskey,
  usePasskeys,
  useRenamePasskey,
} from "@/lib/auth/passkeys";
import { formatShortDateForLocale } from "@/lib/utils/formatDate";

/** Settings > Security > Passkeys: the user's passkeys, with add, rename and delete. */
export default function Passkeys() {
  const t = useTranslations();
  const locale = useLocale();
  const id = useId();
  const { data: passkeys = [], isError, isLoading } = usePasskeys();
  const add = useAddPasskey();
  const rename = useRenamePasskey();
  const remove = useDeletePasskey();

  const [renaming, setRenaming] = useState<Passkey | null>(null);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<Passkey | null>(null);

  const label = (passkey: Passkey) =>
    passkeyLabel(passkey) ?? t("passkeys-default-name");
  const supported = browserSupportsPasskeys();

  const onAdd = async () => {
    try {
      await add.mutateAsync();
      toast.success(t("passkeys-added"));
    } catch (error) {
      if (isPasskeyCancelled(error)) return;
      toast.error(
        t(
          isSessionNotFresh(error)
            ? "passkeys-error-session-not-fresh"
            : "passkeys-error-add",
        ),
      );
    }
  };

  const onRename = async () => {
    const name = newName.trim();
    if (!renaming || !name) return;
    try {
      await rename.mutateAsync({ id: renaming.id, name });
      toast.success(t("passkeys-renamed"));
      setRenaming(null);
    } catch {
      toast.error(t("passkeys-error-rename"));
    }
  };

  const onDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast.success(t("passkeys-deleted"));
    } catch {
      toast.error(t("passkeys-error-delete"));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <section className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-6 py-10 md:grid-cols-3">
      <div>
        <Heading variant="h2">{t("passkeys-title")}</Heading>
        <Text variant="lead" className="mt-1 text-sm">
          {t("passkeys-description")}
        </Text>
      </div>

      <div className="bg-card flex flex-col gap-4 rounded p-4 md:col-span-2">
        {isLoading ? (
          <Text variant="mutedText">{t("passkeys-loading")}</Text>
        ) : isError ? (
          <Text variant="mutedText">{t("passkeys-error-load")}</Text>
        ) : passkeys.length === 0 ? (
          <Text variant="mutedText">{t("passkeys-empty")}</Text>
        ) : (
          <ul className="divide-border divide-y">
            {passkeys.map((passkey) => (
              <li
                key={passkey.id}
                className="flex flex-col gap-2 py-4 first:pt-0 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex flex-col gap-1">
                  <Text className="font-medium">{label(passkey)}</Text>
                  <Text variant="mutedText">
                    {t("passkeys-created-on", {
                      date: formatShortDateForLocale(passkey.createdAt, locale),
                    })}
                  </Text>
                  <Text variant="mutedText">
                    {passkey.lastUsedAt
                      ? t("passkeys-last-used", {
                          date: formatShortDateForLocale(
                            passkey.lastUsedAt,
                            locale,
                            {
                              withTime: true,
                            },
                          ),
                        })
                      : t("passkeys-never-used")}
                  </Text>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={t("passkeys-rename-named", {
                      name: label(passkey),
                    })}
                    onClick={() => {
                      setNewName(passkey.name ?? "");
                      setRenaming(passkey);
                    }}
                  >
                    {t("passkeys-rename")}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    aria-label={t("passkeys-delete-named", {
                      name: label(passkey),
                    })}
                    onClick={() => setDeleting(passkey)}
                  >
                    {t("passkeys-delete")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {supported ? (
          <Button
            type="button"
            className="self-start"
            loading={add.isPending}
            disabled={add.isPending}
            onClick={() => void onAdd()}
          >
            {t("passkeys-add")}
          </Button>
        ) : (
          <Text variant="mutedText">{t("passkeys-unsupported")}</Text>
        )}
      </div>

      <DrawerDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title={t("passkeys-rename-title")}
        footer={
          <Button
            type="submit"
            form={`${id}-rename`}
            loading={rename.isPending}
            disabled={rename.isPending || !newName.trim()}
          >
            {t("save")}
          </Button>
        }
      >
        <form
          id={`${id}-rename`}
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void onRename();
          }}
        >
          <Label htmlFor={`${id}-name`}>{t("passkeys-name")}</Label>
          <Input
            id={`${id}-name`}
            value={newName}
            maxLength={100}
            autoComplete="off"
            onChange={(event) => setNewName(event.target.value)}
          />
        </form>
      </DrawerDialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("passkeys-delete-title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("passkeys-delete-description", {
                name: deleting ? label(deleting) : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onDelete()}>
              {t("passkeys-delete-confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

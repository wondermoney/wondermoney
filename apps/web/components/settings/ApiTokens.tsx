"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { getApiErrorCode } from "@/lib/api/errors";
import {
  type ApiToken,
  type ApiTokenScope,
  useApiTokens,
  useCreateApiToken,
  useRevokeApiToken,
} from "@/lib/api/user/useApiTokens";
import { formatShortDateForLocale } from "@/lib/utils/formatDate";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/Label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/Select";
import { Heading, Text } from "../ui/Typography";

const EXPIRY_OPTIONS = [30, 90, 365] as const;
type ExpiryDays = (typeof EXPIRY_OPTIONS)[number];

function scopeLabel(t: ReturnType<typeof useTranslations>, scope: ApiTokenScope) {
  switch (scope) {
    case "calendar:read":
      return t("scope-calendar-read");
    case "mcp:read":
      return t("scope-mcp-read");
    case "write":
      return t("scope-write");
    default:
      return t("scope-read");
  }
}

/**
 * Settings > Security > API tokens.
 *
 * The plain token exists only in the create response, so the copy-once panel is the only
 * place it is ever shown. The list afterwards is prefix + metadata, read from the server.
 */
export default function ApiTokens() {
  const t = useTranslations("apiTokens");
  const locale = useLocale();
  const id = useId();
  const { data: tokens = [], isLoading } = useApiTokens();
  const create = useCreateApiToken();
  const revoke = useRevokeApiToken();

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiTokenScope[]>(["read"]);
  const [expiresInDays, setExpiresInDays] = useState<ExpiryDays>(90);
  const [totpCode, setTotpCode] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);

  const toggleScope = (scope: ApiTokenScope, checked: boolean) => {
    setScopes((current) =>
      checked
        ? [...new Set([...current, scope])]
        : current.filter((candidate) => candidate !== scope),
    );
  };

  const onCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || scopes.length === 0) return;
    try {
      const result = await create.mutateAsync({
        expiresInDays,
        name: trimmed,
        scopes,
        ...(totpCode.trim() ? { totpCode: totpCode.trim() } : {}),
      });
      setCreatedToken(result.token);
      setName("");
      setScopes(["read"]);
      setTotpCode("");
    } catch (error) {
      const code = getApiErrorCode(error);
      toast.error(
        t(
          code === "totp_required"
            ? "error-totp-required"
            : code === "invalid_totp"
              ? "error-invalid-totp"
              : code === "session_not_fresh"
                ? "error-session-not-fresh"
                : "error-create",
        ),
      );
    }
  };

  const onCopy = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copy-failed"));
    }
  };

  const onRevoke = async () => {
    if (!revoking) return;
    try {
      await revoke.mutateAsync(revoking.id);
      toast.success(t("revoked"));
    } catch {
      toast.error(t("error-revoke"));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div className="flex flex-col gap-10">
      <section className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-3">
        <div>
          <Heading variant="h2">{t("title")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("description")}
          </Text>
        </div>

        <div className="bg-card flex flex-col gap-4 rounded p-4 md:col-span-2">
          {createdToken ? (
            <div className="border-border flex flex-col gap-3 rounded border p-3">
              <Text className="font-medium">{t("created-title")}</Text>
              <Text variant="mutedText">{t("created-description")}</Text>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  readOnly
                  value={createdToken}
                  aria-label={t("created-title")}
                  className="font-mono"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button type="button" variant="default" onClick={() => void onCopy()}>
                  {t("copy")}
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="self-start"
                onClick={() => setCreatedToken(null)}
              >
                {t("created-done")}
              </Button>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-name`}>{t("name")}</Label>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={80}
              placeholder={t("name-placeholder")}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t("scopes")}</legend>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-read`}
                checked={scopes.includes("read")}
                onCheckedChange={(checked) => toggleScope("read", checked === true)}
              />
              <Label htmlFor={`${id}-read`}>{t("scope-read")}</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-write`}
                checked={scopes.includes("write")}
                onCheckedChange={(checked) => toggleScope("write", checked === true)}
              />
              <Label htmlFor={`${id}-write`}>{t("scope-write")}</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-mcp`}
                checked={scopes.includes("mcp:read")}
                onCheckedChange={(checked) => toggleScope("mcp:read", checked === true)}
              />
              <Label htmlFor={`${id}-mcp`}>{t("scope-mcp-read")}</Label>
            </div>
            <Text variant="mutedText">{t("scope-write-hint")}</Text>
            <Text variant="mutedText">{t("scope-mcp-read-hint")}</Text>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-expiry`}>{t("expiry")}</Label>
            <Select
              value={String(expiresInDays)}
              onValueChange={(value) => setExpiresInDays(Number(value) as ExpiryDays)}
            >
              <SelectTrigger id={`${id}-expiry`} className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_OPTIONS.map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    {t("expiry-days", { days })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-totp`}>{t("totp")}</Label>
            <Input
              id={`${id}-totp`}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={totpCode}
              maxLength={6}
              placeholder="123456"
              onChange={(event) => setTotpCode(event.target.value)}
            />
            <Text variant="mutedText">{t("totp-hint")}</Text>
          </div>

          <Button
            type="button"
            variant="default"
            className="self-start"
            loading={create.isPending}
            disabled={!name.trim() || scopes.length === 0}
            onClick={() => void onCreate()}
          >
            {t("create")}
          </Button>
        </div>
      </section>

      <section className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-3">
        <div>
          <Heading variant="h2">{t("list-title")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("list-description")}
          </Text>
        </div>

        <div className="md:col-span-2">
          {isLoading ? (
            <Text variant="mutedText">{t("loading")}</Text>
          ) : tokens.length === 0 ? (
            <Text variant="mutedText">{t("empty")}</Text>
          ) : (
            <ul className="divide-border divide-y">
              {tokens.map((token) => {
                const revoked = token.revokedAt !== null;
                return (
                  <li key={token.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Text className="font-medium">{token.name}</Text>
                        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">{token.prefix}…</code>
                        {revoked ? (
                          <span className="text-destructive-text text-xs">{t("status-revoked")}</span>
                        ) : null}
                      </div>
                      <Text variant="mutedText">
                        {token.scopes.map((scope) => scopeLabel(t, scope)).join(" · ")}
                      </Text>
                      <Text variant="mutedText">
                        {t("expires-on", {
                          date: formatShortDateForLocale(token.expiresAt, locale),
                        })}
                        {token.lastUsedAt
                          ? ` · ${t("last-used", {
                              date: formatShortDateForLocale(token.lastUsedAt, locale, { withTime: true }),
                            })}`
                          : ` · ${t("never-used")}`}
                      </Text>
                    </div>
                    {revoked ? null : (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => setRevoking(token)}
                      >
                        {t("revoke")}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <AlertDialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("revoke-title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("revoke-description", { name: revoking?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onRevoke()}>
              {t("revoke-confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";

import { getApiUrl } from "@/lib/api/api";
import { getApiErrorCode } from "@/lib/api/errors";
import { useFeature } from "@/lib/api/instance/useInstance";
import { useCreateApiToken } from "@/lib/api/user/useApiTokens";
import { useMcpCalls } from "@/lib/api/user/useMcpCalls";
import { formatShortDateForLocale } from "@/lib/utils/formatDate";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/Label";
import { Heading, Text } from "../ui/Typography";

/** The token name the shortcut creates, so it is recognisable in the API-token list. */
export const MCP_TOKEN_NAME = "AI client";
export const MCP_TOKEN_EXPIRY_DAYS = 90;

/**
 * Settings > API tokens > Connect an AI client.
 *
 * An MCP client is a long-lived machine credential, so it gets its own `mcp:read` token rather
 * than the member's `read` token: it reaches only `POST /v1/mcp` and nothing on the ordinary
 * data routes. The panel shows the endpoint, a one-click token, copy-paste client config and
 * the recent calls the server recorded.
 */
export default function ConnectAiClient() {
  const t = useTranslations("connectAiClient");
  const locale = useLocale();
  const id = useId();
  // An older API that does not report `mcp` reads as on, like every other feature.
  const mcpEnabled = useFeature((features) => features.mcp !== false);
  const create = useCreateApiToken();
  const { data: calls = [], isLoading: callsLoading } = useMcpCalls(mcpEnabled);

  const [totpCode, setTotpCode] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  if (!mcpEnabled) return null;

  const endpoint = `${getApiUrl()}/v1/mcp`;
  const tokenForConfig = createdToken ?? "<your-token>";
  const httpConfig = JSON.stringify(
    {
      mcpServers: {
        wondermoney: {
          headers: { Authorization: `Bearer ${tokenForConfig}` },
          url: endpoint,
        },
      },
    },
    null,
    2,
  );
  const claudeConfig = JSON.stringify(
    {
      mcpServers: {
        wondermoney: {
          args: ["-y", "mcp-remote", endpoint, "--header", `Authorization: Bearer ${tokenForConfig}`],
          command: "npx",
        },
      },
    },
    null,
    2,
  );

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copy-failed"));
    }
  };

  const onCreate = async () => {
    try {
      const result = await create.mutateAsync({
        expiresInDays: MCP_TOKEN_EXPIRY_DAYS,
        name: MCP_TOKEN_NAME,
        scopes: ["mcp:read"],
        ...(totpCode.trim() ? { totpCode: totpCode.trim() } : {}),
      });
      setCreatedToken(result.token);
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-endpoint`}>{t("endpoint")}</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={`${id}-endpoint`}
                readOnly
                value={endpoint}
                className="font-mono"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button type="button" variant="outline" onClick={() => void copy(endpoint)}>
                {t("copy")}
              </Button>
            </div>
            <Text variant="mutedText">{t("endpoint-hint")}</Text>
          </div>

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="default"
              className="self-start"
              loading={create.isPending}
              onClick={() => void onCreate()}
            >
              {t("create-token")}
            </Button>
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
          </div>

          {createdToken ? (
            <div className="border-border flex flex-col gap-3 rounded border p-3">
              <Text className="font-medium">{t("token-created-title")}</Text>
              <Text variant="mutedText">{t("token-created-description")}</Text>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  readOnly
                  value={createdToken}
                  aria-label={t("token-created-title")}
                  className="font-mono"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button type="button" variant="default" onClick={() => void copy(createdToken)}>
                  {t("copy")}
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="self-start"
                onClick={() => setCreatedToken(null)}
              >
                {t("token-done")}
              </Button>
            </div>
          ) : null}

          <div className="flex flex-col gap-3">
            <div>
              <Text className="font-medium">{t("config-title")}</Text>
              <Text variant="mutedText">{t("config-description")}</Text>
            </div>
            <div className="flex flex-col gap-1.5">
              <Text className="font-medium">{t("config-claude")}</Text>
              <div className="flex flex-col gap-2">
                <pre
                  id={`${id}-claude`}
                  className="bg-muted overflow-x-auto rounded p-3 font-mono text-xs"
                >
                  {claudeConfig}
                </pre>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => void copy(claudeConfig)}
                >
                  {t("copy")}
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Text className="font-medium">{t("config-http")}</Text>
              <div className="flex flex-col gap-2">
                <pre
                  id={`${id}-http`}
                  className="bg-muted overflow-x-auto rounded p-3 font-mono text-xs"
                >
                  {httpConfig}
                </pre>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => void copy(httpConfig)}
                >
                  {t("copy")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-3">
        <div>
          <Heading variant="h2">{t("calls-title")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("calls-description")}
          </Text>
        </div>

        <div className="md:col-span-2">
          {callsLoading ? (
            <Text variant="mutedText">{t("calls-loading")}</Text>
          ) : calls.length === 0 ? (
            <Text variant="mutedText">{t("calls-empty")}</Text>
          ) : (
            <ul className="divide-border divide-y">
              {calls.map((call, index) => (
                <li
                  key={`${call.createdAt}-${index}`}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <code className="font-mono text-sm">{call.toolName ?? t("calls-unknown-tool")}</code>
                  <Text variant="mutedText">
                    {formatShortDateForLocale(call.createdAt, locale, { withTime: true })}
                  </Text>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

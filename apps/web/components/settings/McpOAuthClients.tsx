"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import {
  type McpOAuthClient,
  useMcpOAuthClients,
  useRevokeMcpOAuthClient,
} from "@/lib/api/user/useMcpOAuthClients";
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
import { Heading, Text } from "../ui/Typography";

/** A client's name as the list shows it: its self-declared name, else where it lives. */
function clientLabel(client: McpOAuthClient, fallback: string): string {
  return client.name ?? client.redirectHost ?? fallback;
}

/**
 * Settings > API tokens > Connect an AI client > Connected with OAuth: how to add the server to
 * ChatGPT (or any client that signs in with OAuth), and the clients the member has allowed, each
 * revocable. Shown only when the server offers OAuth (`features.mcpOAuth`).
 */
export default function McpOAuthClients({ endpoint }: { endpoint: string }) {
  const t = useTranslations("connectAiClient");
  const locale = useLocale();
  const { data: clients = [], isLoading } = useMcpOAuthClients();
  const revoke = useRevokeMcpOAuthClient();
  const [revoking, setRevoking] = useState<McpOAuthClient | null>(null);

  const onRevoke = async () => {
    if (!revoking) return;
    try {
      await revoke.mutateAsync(revoking.clientId);
      toast.success(t("oauth-revoked"));
    } catch {
      toast.error(t("oauth-error-revoke"));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <section className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-3">
      <div>
        <Heading variant="h2">{t("oauth-title")}</Heading>
        <Text variant="lead" className="mt-1 text-sm">
          {t("oauth-description")}
        </Text>
      </div>

      <div className="bg-card flex flex-col gap-4 rounded p-4 md:col-span-2">
        <div className="flex flex-col gap-1.5">
          <Text className="font-medium">{t("oauth-chatgpt-title")}</Text>
          <Text variant="mutedText">
            {t("oauth-chatgpt-steps", { endpoint })}
          </Text>
        </div>

        {isLoading ? (
          <Text variant="mutedText">{t("oauth-loading")}</Text>
        ) : clients.length === 0 ? (
          <Text variant="mutedText">{t("oauth-empty")}</Text>
        ) : (
          <ul className="divide-border divide-y">
            {clients.map((client) => (
              <li
                key={client.clientId}
                className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex flex-col gap-1">
                  <Text className="font-medium">
                    {clientLabel(client, t("oauth-unnamed"))}
                  </Text>
                  {client.redirectHost && client.name ? (
                    <Text variant="mutedText" className="font-mono text-xs">
                      {client.redirectHost}
                    </Text>
                  ) : null}
                  <Text variant="mutedText">
                    {t("oauth-connected-on", {
                      date: formatShortDateForLocale(
                        client.connectedAt,
                        locale,
                      ),
                    })}
                    {client.lastUsedAt
                      ? ` · ${t("oauth-last-used", {
                          date: formatShortDateForLocale(
                            client.lastUsedAt,
                            locale,
                            {
                              withTime: true,
                            },
                          ),
                        })}`
                      : ` · ${t("oauth-never-used")}`}
                  </Text>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setRevoking(client)}
                >
                  {t("oauth-revoke")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AlertDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("oauth-revoke-title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("oauth-revoke-description", {
                name: revoking ? clientLabel(revoking, t("oauth-unnamed")) : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("oauth-cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onRevoke()}>
              {t("oauth-revoke-confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

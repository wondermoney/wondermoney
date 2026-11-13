"use client";

import { bankSyncErrorCopy } from "@wondermoney/shared/bank-sync";
import { History, Unplug } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
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
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SimpleTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { Text } from "@/components/ui/Typography";
import type {
  BankConnectionStatus,
  SimplefinBankConnection,
} from "@/lib/api/banking/useBankConnections";
import { useDisconnectSimplefin } from "@/lib/api/banking/useSimplefin";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import { formatShortDateForLocale } from "@/lib/utils/formatDate";

import SyncHistoryDrawer from "./SyncHistoryDrawer";

type SimplefinStatus = Exclude<BankConnectionStatus, "expiring">;

const STATUS_VARIANT: Record<SimplefinStatus, BadgeProps["variant"]> = {
  connected: "success",
  error: "destructive",
  expired: "warning",
  processing: "secondary",
  revoked: "warning",
};

function statusOf(connection: SimplefinBankConnection): SimplefinStatus {
  // SimpleFIN has no consent end date, so the API never says `expiring`; read one as connected.
  return connection.status === "expiring" ? "connected" : connection.status;
}

/**
 * The person's SimpleFIN connections, under Settings → Bank connections. SimpleFIN numbers its
 * connections apart from Enable Banking, so history and disconnect use its own routes. There is
 * no reconnect: a revoked access needs a new setup token, which is a new connection.
 */
export default function SimplefinConnectionsTable({
  connections,
}: {
  connections: SimplefinBankConnection[];
}) {
  const t = useTranslations();
  const locale = useLocale();
  const notifyIfRateLimited = useRateLimitToast();
  const disconnect = useDisconnectSimplefin();
  const [history, setHistory] = useState<SimplefinBankConnection | null>(null);
  const [disconnecting, setDisconnecting] =
    useState<SimplefinBankConnection | null>(null);

  const nameOf = (connection: SimplefinBankConnection) =>
    connection.institutionName ?? t("simplefin.name");

  const onConfirmDisconnect = () => {
    if (!disconnecting) return;
    disconnect.mutate(disconnecting.connectionId, {
      onSuccess: () => toast.success(t("simplefin.disconnect-success")),
      onError: (error) => {
        if (notifyIfRateLimited(error)) return;
        toast.error(t("simplefin.disconnect-error"));
      },
    });
    setDisconnecting(null);
  };

  return (
    <>
      <div className="overflow-x-auto">
        <SimpleTable>
          <TableHeader>
            <TableRow>
              <TableHead>{t("provider")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead>{t("simplefin.updated")}</TableHead>
              <TableHead>{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {connections.map((connection) => {
              const status = statusOf(connection);
              const lastErrorKey =
                status === "error" && connection.lastError
                  ? bankSyncErrorCopy(connection.lastError.code).messageKey
                  : null;
              return (
                <TableRow key={connection.connectionId}>
                  <TableCell>
                    <Text variant="smallText">{nameOf(connection)}</Text>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Badge variant={STATUS_VARIANT[status]}>
                        {t(`simplefin.status.${status}`)}
                      </Badge>
                      {status === "revoked" ? (
                        <Text variant="mutedText" className="max-w-xs text-xs">
                          {t("simplefin.revoked-help")}
                        </Text>
                      ) : lastErrorKey ? (
                        <Text variant="mutedText" className="max-w-xs text-xs">
                          {t(lastErrorKey)}
                        </Text>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm tabular-nums">
                      {connection.dataFreshAsOf
                        ? formatShortDateForLocale(
                            connection.dataFreshAsOf,
                            locale,
                            { withTime: true },
                          )
                        : t("simplefin.never-synced")}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setHistory(connection)}
                      >
                        <History className="size-4" aria-hidden="true" />
                        {t("bank-sync.history.action")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1.5"
                        disabled={disconnect.isPending}
                        onClick={() => setDisconnecting(connection)}
                      >
                        <Unplug className="size-4" aria-hidden="true" />
                        {t("simplefin.disconnect")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </SimpleTable>
      </div>

      <SyncHistoryDrawer
        open={history !== null}
        onOpenChange={(open) => {
          if (!open) setHistory(null);
        }}
        connectionId={history?.connectionId ?? null}
        institutionName={history ? nameOf(history) : null}
        provider="SimpleFIN"
      />

      <AlertDialog
        open={disconnecting !== null}
        onOpenChange={(open) => {
          if (!open) setDisconnecting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("simplefin.disconnect-title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("simplefin.disconnect-body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDisconnect}>
              {t("simplefin.disconnect")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

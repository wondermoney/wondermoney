"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { Textarea } from "@/components/ui/textarea";
import { Text } from "@/components/ui/Typography";
import useBankConnections, {
  simplefinConnections,
} from "@/lib/api/banking/useBankConnections";
import {
  SIMPLEFIN_BRIDGE_URL,
  useConnectSimplefin,
} from "@/lib/api/banking/useSimplefin";
import {
  API_ERROR_CODE,
  getApiErrorCode,
  getApiErrorMessage,
} from "@/lib/api/errors";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import { invalidateAccounts } from "@/lib/utils/queryInvalidation";

const FORM_ID = "simplefin-connect-form";
const emptyValues = { setupToken: "" };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rendered as the dialog's trigger; omit when the caller opens it. */
  trigger?: React.ReactNode;
}

/**
 * "Connect with SimpleFIN": the person pastes the setup token they made at SimpleFIN Bridge and
 * the API claims it. The token lives only in this form until it is submitted: the field is
 * cleared the moment it is sent, it is never logged, captured or stored, and the finished
 * mutation drops it (`useConnectSimplefin`). A refusal is shown in place, with the API's own
 * user-safe message for a bad token, so the person can paste a new one.
 *
 * Accounts arrive with the first sync, after the dialog has closed; it keeps watching the new
 * connection and refreshes the account lists once that sync is done.
 */
export default function SimplefinConnectDialog({
  open,
  onOpenChange,
  trigger,
}: Props) {
  const t = useTranslations("simplefin");
  const notifyIfRateLimited = useRateLimitToast();
  const connect = useConnectSimplefin();
  const [error, setError] = useState<string | null>(null);
  const [importingConnectionId, setImportingConnectionId] = useState<
    number | null
  >(null);

  const schema = z.object({
    setupToken: z
      .string()
      .trim()
      .min(1, { message: t("token-required") }),
  });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: emptyValues,
  });

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setError(null);
      form.reset(emptyValues);
    }
    onOpenChange(next);
  };

  const onSubmit = form.handleSubmit(({ setupToken }) => {
    setError(null);
    form.reset(emptyValues);
    connect.mutate(setupToken.trim(), {
      onSuccess: ({ connectionId }) => {
        toast.success(t("success"));
        setImportingConnectionId(connectionId);
        onOpenChange(false);
      },
      onError: (err) => {
        if (notifyIfRateLimited(err)) return;
        setError(connectErrorMessage(err, t));
      },
      // Drop the token from the observer's `variables` too.
      onSettled: () => connect.reset(),
    });
  });

  return (
    <>
      <DrawerDialog
        title={t("connect")}
        open={open}
        onOpenChange={handleOpenChange}
        trigger={trigger}
        footer={
          <Button
            type="submit"
            form={FORM_ID}
            loading={connect.isPending}
            disabled={connect.isPending}
          >
            {t("submit")}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Text variant="mutedText" className="text-sm">
            {t("intro")}
          </Text>
          <a
            href={SIMPLEFIN_BRIDGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4"
          >
            {t("get-token")}
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>

          <Form {...form}>
            <form
              id={FORM_ID}
              onSubmit={onSubmit}
              className="flex flex-col gap-4"
            >
              <FormField
                control={form.control}
                name="setupToken"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("token-label")}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={4}
                        className="font-mono text-xs break-all"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        data-1p-ignore
                        data-lpignore="true"
                        placeholder={t("token-placeholder")}
                      />
                    </FormControl>
                    <Text variant="mutedText" className="text-xs">
                      {t("token-hint")}
                    </Text>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>

          {error ? <Alert variant="destructive">{error}</Alert> : null}
        </div>
      </DrawerDialog>
      {importingConnectionId !== null ? (
        <FirstSyncWatcher
          connectionId={importingConnectionId}
          onDone={() => setImportingConnectionId(null)}
        />
      ) : null}
    </>
  );
}

type ConnectErrorKey =
  | "error-disabled"
  | "error-generic"
  | "error-server-not-allowed"
  | "error-token-already-claimed"
  | "error-token-invalid"
  | "error-unreachable";

/** The API's codes for a refused setup token, each with its own translated copy. */
const TOKEN_ERROR_KEYS = new Map<string, ConnectErrorKey>([
  [API_ERROR_CODE.SIMPLEFIN_TOKEN_INVALID, "error-token-invalid"],
  [API_ERROR_CODE.SIMPLEFIN_TOKEN_ALREADY_CLAIMED, "error-token-already-claimed"],
  [API_ERROR_CODE.SIMPLEFIN_SERVER_NOT_ALLOWED, "error-server-not-allowed"],
]);

function connectErrorMessage(
  error: unknown,
  t: (key: ConnectErrorKey) => string,
): string {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  // A 400 is the token itself (invalid, already claimed, a server SimpleFIN does not allow).
  // Known codes get translated copy; any other 400 shows the API's message, written for the
  // person.
  if (status === 400) {
    const code = getApiErrorCode(error);
    const key = code ? TOKEN_ERROR_KEYS.get(code) : undefined;
    return key ? t(key) : (getApiErrorMessage(error) ?? t("error-generic"));
  }
  if (status === 501) return t("error-disabled");
  if (status === 502 || status === 503 || status === 504) {
    return t("error-unreachable");
  }
  return t("error-generic");
}

/**
 * Polls the connection list (through `useBankConnections`) until the new connection's first
 * sync has finished, then refreshes everything that lists accounts.
 */
function FirstSyncWatcher({
  connectionId,
  onDone,
}: {
  connectionId: number;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { data } = useBankConnections();
  const status = simplefinConnections(data?.connections).find(
    (connection) => connection.connectionId === connectionId,
  )?.status;

  useEffect(() => {
    if (!status || status === "processing") return;
    void invalidateAccounts(queryClient);
    onDone();
  }, [status, queryClient, onDone]);

  return null;
}

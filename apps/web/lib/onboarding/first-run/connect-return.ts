const NOT_LINKED_ERRORS = new Set(["cancelled", "requisition_not_found"]);

/**
 * Errors the API only emits *after* the requisition reached `linked` — the bank
 * connection itself succeeded and only the follow-on account sync had trouble.
 *
 * These must never fall through to `error_not_linked`. RAD-588: when the sync
 * enqueue threw before an incident id existed, the callback redirected with
 * `err=queue_unavailable` and no `sync` param, and the old `incidentId`-only
 * check sent the user back to "Connection wasn't completed. Try again or pick
 * another bank." — for a bank that was, in fact, connected.
 */
const LINKED_SYNC_TROUBLE_ERRORS = new Set(["queue_unavailable"]);

export type ConnectReturn =
  | { kind: "none" }
  | { kind: "connected"; incidentId?: string }
  | { kind: "error_not_linked"; error: string }
  | { kind: "error_sync_trouble"; error: string; incidentId?: string };

export function resolveConnectReturn(params: URLSearchParams): ConnectReturn {
  if (params.get("origin") !== "nordingen") return { kind: "none" };

  const incidentId = params.get("sync") ?? undefined;
  const error = params.get("err") ?? undefined;

  if (!error) return { kind: "connected", incidentId };

  // Requisition never linked: send the user back to pick a bank / skip.
  if (NOT_LINKED_ERRORS.has(error) && !incidentId) {
    return { kind: "error_not_linked", error };
  }
  // Linked but the sync job had trouble (queue_unavailable, partial, etc.).
  // Known linked-side errors count even without an incident id, because the
  // failure that produces them can happen before the incident is allocated.
  if (LINKED_SYNC_TROUBLE_ERRORS.has(error) || incidentId) {
    return { kind: "error_sync_trouble", error, incidentId };
  }

  return { kind: "error_not_linked", error };
}

export function connectReturnPatch(
  result: ConnectReturn,
): { accountStep: "connected"; currentStep: "sync_value" } | null {
  if (result.kind === "connected" || result.kind === "error_sync_trouble") {
    return { accountStep: "connected", currentStep: "sync_value" };
  }
  return null;
}

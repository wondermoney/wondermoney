import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

import api from "../api";

/**
 * Restoring a WonderMoney export into the signed-in owner's empty household
 * (`/v1/user/me/restores`).
 *
 * The flow: `start` with the file size returns a link to PUT the zip to; `validate` (with the
 * password of a protected export) checks the file in the background and records what it would
 * restore (`ready`) or why it cannot (`invalid`, with `error.code`); `commit` restores it, also in
 * the background. The overview says whether the person can restore at all.
 */
export type DataRestoreStatus =
  | "awaiting_upload"
  | "validating"
  | "invalid"
  | "ready"
  | "restoring"
  | "restored"
  | "failed"
  | "expired";

export type DataRestoreErrorCode =
  | "corrupt"
  | "household_not_empty"
  | "internal"
  | "invalid_data"
  | "not_an_export"
  | "password_incorrect"
  | "password_required"
  | "too_large"
  | "unknown_currency"
  | "unknown_type"
  | "unsupported_version"
  | "upload_too_large";

export type DataRestoreWarningCode =
  | "assets_left_out"
  | "bank_linked_accounts"
  | "categories_created"
  | "currency_changed"
  | "members_merged"
  | "price_overrides_skipped"
  | "rules_skipped"
  | "unknown_account_types"
  | "unknown_brokers"
  | "unknown_institutions";

export interface DataRestoreWarning {
  code: DataRestoreWarningCode;
  count: number;
  values: string[];
}

export interface DataRestore {
  createdAt: string;
  encrypted: boolean | null;
  error: {
    code: DataRestoreErrorCode;
    field?: string;
    file?: string;
    row?: number;
    values?: string[];
  } | null;
  expiresAt: string | null;
  export: { appVersion: string; exportedAt: string } | null;
  finishedAt: string | null;
  id: string;
  status: DataRestoreStatus;
  summary: {
    counts: Partial<Record<string, number>>;
    warnings: DataRestoreWarning[];
  } | null;
  upload: {
    headers: Record<string, string>;
    maxBytes: number;
    method: "PUT";
    url: string;
  } | null;
}

export interface DataRestoreOverview {
  availability: {
    eligible: boolean;
    reason:
      "file_storage_disabled" | "household_not_empty" | "owner_required" | null;
  };
  restores: DataRestore[];
}

interface DataRestoreApiClient {
  get: typeof api.get;
  post: typeof api.post;
}

/** The largest file the server accepts, as it says when a restore starts. */
export const DATA_RESTORE_MAX_BYTES = 64 * 1024 * 1024;

const DATA_RESTORES_KEY = ["user", "data-restores"] as const;
const POLL_INTERVAL_MS = 2000;

export async function getDataRestoreOverview(
  apiClient: DataRestoreApiClient = api,
): Promise<DataRestoreOverview> {
  const { data } = await apiClient.get<DataRestoreOverview>(
    "/v1/user/me/restores",
  );
  return data;
}

/**
 * Start a restore of `file` and upload it to the link the server signs for its size. Resolves
 * with the restore, ready to validate.
 */
export async function uploadDataRestore(
  file: Blob,
  apiClient: DataRestoreApiClient = api,
  put: typeof axios.put = axios.put,
): Promise<DataRestore> {
  const { data } = await apiClient.post<{ restore: DataRestore }>(
    "/v1/user/me/restores",
    { size: file.size },
  );
  const { upload } = data.restore;
  if (!upload) throw new Error("The server did not return an upload link");
  // Straight to file storage: no cookies, no API headers, only what the link was signed for.
  await put(upload.url, file, {
    headers: upload.headers,
    withCredentials: false,
  });
  return data.restore;
}

/** Check the uploaded file. The password goes in the request body only, never in a URL. */
export async function validateDataRestore(
  id: string,
  options: { password?: string } = {},
  apiClient: DataRestoreApiClient = api,
): Promise<DataRestore> {
  const { data } = await apiClient.post<{ restore: DataRestore }>(
    `/v1/user/me/restores/${encodeURIComponent(id)}/validate`,
    options.password === undefined ? {} : { password: options.password },
  );
  return data.restore;
}

export async function commitDataRestore(
  id: string,
  apiClient: DataRestoreApiClient = api,
): Promise<DataRestore> {
  const { data } = await apiClient.post<{ restore: DataRestore }>(
    `/v1/user/me/restores/${encodeURIComponent(id)}/commit`,
  );
  return data.restore;
}

/** Whether the server is still working on a restore, so its status is worth polling. */
export function isDataRestoreBusy(restore?: DataRestore | null) {
  return restore?.status === "validating" || restore?.status === "restoring";
}

/** Whether the person can restore now, and their latest restore, polled while it is being worked on. */
export function useDataRestoreOverview(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: DATA_RESTORES_KEY,
    queryFn: () => getDataRestoreOverview(),
    enabled: options.enabled ?? true,
    refetchInterval: (query) =>
      isDataRestoreBusy(query.state.data?.restores[0])
        ? POLL_INTERVAL_MS
        : false,
  });
}

function useStoreRestore() {
  const queryClient = useQueryClient();
  return (restore: DataRestore) => {
    queryClient.setQueryData<DataRestoreOverview>(
      DATA_RESTORES_KEY,
      (current) =>
        current
          ? {
              ...current,
              restores: [
                restore,
                ...current.restores.filter((item) => item.id !== restore.id),
              ],
            }
          : current,
    );
  };
}

/** Start a restore of a file and validate it straight away (without a password). */
export function useUploadDataRestore() {
  const store = useStoreRestore();
  return useMutation({
    mutationFn: async (file: Blob) => {
      const restore = await uploadDataRestore(file);
      return validateDataRestore(restore.id);
    },
    onSuccess: store,
  });
}

export function useValidateDataRestore() {
  const store = useStoreRestore();
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password?: string }) =>
      validateDataRestore(id, password === undefined ? {} : { password }),
    onSuccess: store,
  });
}

export function useCommitDataRestore() {
  const store = useStoreRestore();
  return useMutation({
    mutationFn: (id: string) => commitDataRestore(id),
    onSuccess: store,
  });
}

/**
 * After a restore everything the app shows has changed: drop every cached query so each screen
 * loads the restored data.
 */
export function useReloadAfterRestore() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries();
}

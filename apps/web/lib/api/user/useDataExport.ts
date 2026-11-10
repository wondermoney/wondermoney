import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import api from "../api";

/**
 * Full data export (`/v1/user/me/exports`): a zip of everything the signed-in member can see.
 *
 * `delivery` says how the file arrives. `storage`: a background job prepares it and the
 * response carries a short-lived `downloadUrl` once `status` is `ready`. `stream`: the server has
 * no file storage, so the zip is built while it downloads, from the `/download` endpoint, once.
 */
export type DataExportStatus =
  | "queued"
  | "running"
  | "ready"
  | "failed"
  | "expired";

export interface DataExport {
  createdAt: string;
  delivery: "storage" | "stream";
  downloadUrl: string | null;
  /** Whether the archive is password protected (a WinZip AES-256 zip). */
  encrypted: boolean;
  expiresAt: string | null;
  fileName: string;
  finishedAt: string | null;
  id: string;
  status: DataExportStatus;
}

interface DataExportApiClient {
  get: typeof api.get;
  post: typeof api.post;
}

const DATA_EXPORTS_KEY = ["user", "data-exports"] as const;
const POLL_INTERVAL_MS = 3000;

async function listDataExports(
  apiClient: DataExportApiClient = api,
): Promise<DataExport[]> {
  const { data } = await apiClient.get<{ exports: DataExport[] }>(
    "/v1/user/me/exports",
  );
  return data.exports;
}

/** The shortest password a protected export accepts, in characters, as the API counts them. */
export const DATA_EXPORT_PASSWORD_MIN_LENGTH = 16;

/** Characters as a person counts them ("é" is one), the way the API checks the minimum. */
export function dataExportPasswordLength(password: string) {
  return [...password].length;
}

/**
 * Start an export. With `password` the server encrypts the archive with it; the password goes
 * in the request body only, never in a URL.
 */
async function startDataExport(
  options: { password?: string } = {},
  apiClient: DataExportApiClient = api,
): Promise<DataExport> {
  const { data } = await apiClient.post<{ export: DataExport }>(
    "/v1/user/me/exports",
    options.password === undefined ? {} : { password: options.password },
  );
  return data.export;
}

/** The zip of a `stream` export, built by the server as it downloads. */
export async function downloadStreamedDataExport(
  id: string,
  apiClient: DataExportApiClient = api,
): Promise<Blob> {
  const { data } = await apiClient.get<Blob>(
    `/v1/user/me/exports/${encodeURIComponent(id)}/download`,
    { responseType: "blob", headers: { Accept: "application/zip" } },
  );
  return data;
}

/** Whether the server is still preparing a stored export, so its status is worth polling. */
export function isDataExportPreparing(dataExport?: DataExport | null) {
  return (
    dataExport?.delivery === "storage" &&
    (dataExport.status === "queued" || dataExport.status === "running")
  );
}

/** The member's most recent export of the last 24 hours, polled while it is being prepared. */
export function useLatestDataExport() {
  return useQuery({
    queryKey: DATA_EXPORTS_KEY,
    queryFn: () => listDataExports(),
    select: (exports) => exports[0] ?? null,
    refetchInterval: (query) =>
      isDataExportPreparing(query.state.data?.[0]) ? POLL_INTERVAL_MS : false,
  });
}

export function useStartDataExport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (options: { password?: string } = {}) =>
      startDataExport(options),
    onSuccess: (dataExport) => {
      queryClient.setQueryData<DataExport[]>(DATA_EXPORTS_KEY, (current) => [
        dataExport,
        ...(current ?? []).filter((item) => item.id !== dataExport.id),
      ]);
    },
  });
}

export function useRefreshDataExports() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: DATA_EXPORTS_KEY });
}

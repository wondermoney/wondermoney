import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import api from "../api";
import { reportsKeys } from "../reports/keys";
import type {
  CreateManualAssetRequest,
  ManualAsset,
  ManualAssetValuation,
  SaveValuationRequest,
  UpdateManualAssetRequest,
} from "./types";

/**
 * An asset's value is part of net worth, today and in its history, so every
 * change to an asset or a valuation refreshes those along with the asset. A
 * loan shows the asset it is secured against by name and value, so the loans
 * refresh too.
 */
export function invalidateManualAssets(
  queryClient: QueryClient,
  manualAssetId?: number | string,
) {
  queryClient.invalidateQueries({ queryKey: ["manual-assets"] });
  if (manualAssetId !== undefined) {
    queryClient.invalidateQueries({
      queryKey: ["manual-asset", String(manualAssetId)],
    });
  }
  queryClient.invalidateQueries({ queryKey: ["net-worth"] });
  queryClient.invalidateQueries({ queryKey: ["net-worth-history"] });
  queryClient.invalidateQueries({
    queryKey: [...reportsKeys.all, "net-worth-history"],
  });
  queryClient.invalidateQueries({ queryKey: ["loans"] });
  queryClient.invalidateQueries({ queryKey: ["loan"] });
}

export function useCreateManualAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateManualAssetRequest) => {
      const { data } = await api.post<{ asset: ManualAsset }>(
        "/v1/manual-assets",
        payload,
      );
      return data.asset;
    },
    onSuccess: () => invalidateManualAssets(queryClient),
  });
}

export function useUpdateManualAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      manualAssetId,
      payload,
    }: {
      manualAssetId: number | string;
      payload: UpdateManualAssetRequest;
    }) => {
      const { data } = await api.patch<{ asset: ManualAsset }>(
        `/v1/manual-assets/${manualAssetId}`,
        payload,
      );
      return data.asset;
    },
    onSuccess: (_asset, { manualAssetId }) =>
      invalidateManualAssets(queryClient, manualAssetId),
  });
}

export function useDeleteManualAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (manualAssetId: number | string) =>
      api.delete(`/v1/manual-assets/${manualAssetId}`),
    onSuccess: () => {
      // The asset is gone: refresh the list and net worth, but do not refetch
      // its own page, which would only answer 404.
      invalidateManualAssets(queryClient);
    },
  });
}

/** Record a valuation, or correct an existing one when `valuationId` is given. */
export function useSaveValuation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      manualAssetId,
      valuationId,
      payload,
    }: {
      manualAssetId: number | string;
      valuationId?: number;
      payload: SaveValuationRequest;
    }) => {
      const base = `/v1/manual-assets/${manualAssetId}/valuations`;
      const { data } =
        valuationId === undefined
          ? await api.post<{ valuation: ManualAssetValuation }>(base, payload)
          : await api.patch<{ valuation: ManualAssetValuation }>(
              `${base}/${valuationId}`,
              payload,
            );
      return data.valuation;
    },
    onSuccess: (_valuation, { manualAssetId }) =>
      invalidateManualAssets(queryClient, manualAssetId),
  });
}

export function useDeleteValuation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      manualAssetId,
      valuationId,
    }: {
      manualAssetId: number | string;
      valuationId: number;
    }) =>
      api.delete(
        `/v1/manual-assets/${manualAssetId}/valuations/${valuationId}`,
      ),
    onSuccess: (_data, { manualAssetId }) =>
      invalidateManualAssets(queryClient, manualAssetId),
  });
}

/** One row of a manual-assets file, as the import endpoint takes it. */
export interface ImportManualAssetRequestRow {
  name: string;
  kind: ManualAsset["kind"];
  value: number;
  valuationDate?: string;
  currencyCode: string;
  isPrivate?: boolean;
}

/** Creates every row of a manual-assets file as an asset with its valuation, or none of them. */
export function useImportManualAssets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (assets: ImportManualAssetRequestRow[]) => {
      const { data } = await api.post<{
        assets: { manualAssetKey: number; name: string }[];
      }>("/v1/manual-assets/import", { assets });
      return data.assets;
    },
    onSuccess: () => invalidateManualAssets(queryClient),
  });
}

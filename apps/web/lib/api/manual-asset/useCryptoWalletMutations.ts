import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import api from "../api";
import type {
  CreateCryptoWalletRequest,
  CreateCryptoWalletResponse,
  CryptoWalletAddressRequest,
  CryptoWalletDto,
  GetManualAssetResponse,
} from "./types";
import { invalidateManualAssets } from "./useManualAssetMutations";

/**
 * A wallet change answers with the whole wallet: put it on the asset's page at
 * once, then refresh the asset and net worth as any other asset change does
 * (ticking a token or adding an address starts a sync that moves the value).
 */
function settleWallet(
  queryClient: QueryClient,
  manualAssetId: number | string,
  wallet: CryptoWalletDto,
) {
  queryClient.setQueryData<GetManualAssetResponse>(
    ["manual-asset", String(manualAssetId)],
    (current) => (current ? { ...current, wallet } : current),
  );
  invalidateManualAssets(queryClient, manualAssetId);
}

export function useCreateCryptoWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateCryptoWalletRequest) => {
      const { data } = await api.post<CreateCryptoWalletResponse>(
        "/v1/manual-assets/crypto-wallets",
        payload,
      );
      return data;
    },
    onSuccess: () => invalidateManualAssets(queryClient),
  });
}

export function useAddWalletAddress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      manualAssetId,
      payload,
    }: {
      manualAssetId: number | string;
      payload: CryptoWalletAddressRequest;
    }) => {
      const { data } = await api.post<{ wallet: CryptoWalletDto }>(
        `/v1/manual-assets/${manualAssetId}/addresses`,
        payload,
      );
      return data.wallet;
    },
    onSuccess: (wallet, { manualAssetId }) =>
      settleWallet(queryClient, manualAssetId, wallet),
  });
}

export function useUpdateWalletAddressLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      manualAssetId,
      addressId,
      label,
    }: {
      manualAssetId: number | string;
      addressId: number;
      label: string | null;
    }) => {
      const { data } = await api.patch<{ wallet: CryptoWalletDto }>(
        `/v1/manual-assets/${manualAssetId}/addresses/${addressId}`,
        { label },
      );
      return data.wallet;
    },
    onSuccess: (wallet, { manualAssetId }) =>
      settleWallet(queryClient, manualAssetId, wallet),
  });
}

export function useRemoveWalletAddress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      manualAssetId,
      addressId,
    }: {
      manualAssetId: number | string;
      addressId: number;
    }) => {
      const { data } = await api.delete<{ wallet: CryptoWalletDto }>(
        `/v1/manual-assets/${manualAssetId}/addresses/${addressId}`,
      );
      return data.wallet;
    },
    onSuccess: (wallet, { manualAssetId }) =>
      settleWallet(queryClient, manualAssetId, wallet),
  });
}

/** Tick a token to count it in the wallet's value, or untick it to ignore it. */
export function useSetWalletTokenTracked() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      manualAssetId,
      tokenId,
      tracked,
    }: {
      manualAssetId: number | string;
      tokenId: number;
      tracked: boolean;
    }) => {
      const { data } = await api.patch<{ wallet: CryptoWalletDto }>(
        `/v1/manual-assets/${manualAssetId}/tokens/${tokenId}`,
        { tracked },
      );
      return data.wallet;
    },
    onSuccess: (wallet, { manualAssetId }) =>
      settleWallet(queryClient, manualAssetId, wallet),
  });
}

/** Queue a fresh read of every address; the balances and value follow when it is done. */
export function useSyncCryptoWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (manualAssetId: number | string) => {
      await api.post<{ queued: true }>(
        `/v1/manual-assets/${manualAssetId}/sync`,
      );
    },
    onSuccess: (_data, manualAssetId) =>
      invalidateManualAssets(queryClient, manualAssetId),
  });
}

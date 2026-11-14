import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import api from "../api";

/**
 * QR pairing with the mobile app (`/v1/user/pairing-codes`, `/v1/user/devices`).
 *
 * The pairing code is short-lived (two minutes) and single-use, so the web shows it, counts
 * it down and then mints a new one rather than storing it. The device list is the phone's
 * session: revoking one ends it.
 */
export interface PairingCode {
  code: string;
  expiresAt: string;
  /** `wondermoney://pair?server=…&code=…`, the QR's contents. */
  url: string;
}

export interface MobileDevice {
  /** The better-auth session id. */
  id: string;
  label: string;
  lastSeenAt: string;
  pairedAt: string;
}

interface MobileDevicesApiClient {
  delete: typeof api.delete;
  get: typeof api.get;
  post: typeof api.post;
}

const MOBILE_DEVICES_KEY = ["user", "mobile-devices"] as const;

export async function createPairingCode(
  totpCode: string | undefined,
  apiClient: MobileDevicesApiClient = api,
): Promise<PairingCode> {
  const { data } = await apiClient.post<{ pairingCode: PairingCode }>(
    "/v1/user/pairing-codes",
    {},
    totpCode ? { headers: { "x-totp-code": totpCode } } : undefined,
  );
  return data.pairingCode;
}

export async function listMobileDevices(
  apiClient: MobileDevicesApiClient = api,
): Promise<MobileDevice[]> {
  const { data } = await apiClient.get<{ devices: MobileDevice[] }>(
    "/v1/user/devices",
  );
  return data.devices;
}

export async function revokeMobileDevice(
  sessionId: string,
  apiClient: MobileDevicesApiClient = api,
): Promise<void> {
  await apiClient.delete(`/v1/user/devices/${encodeURIComponent(sessionId)}`);
}

export function useMobileDevices() {
  return useQuery({
    queryKey: MOBILE_DEVICES_KEY,
    queryFn: () => listMobileDevices(),
  });
}

export function useCreatePairingCode() {
  return useMutation({
    mutationFn: (totpCode?: string) => createPairingCode(totpCode),
  });
}

export function useRevokeMobileDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => revokeMobileDevice(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MOBILE_DEVICES_KEY });
    },
  });
}

import type { DiagnosticCaptureClient } from "@/lib/analytics/safe-diagnostics";
import { safePostHogCapture } from "@/lib/analytics/safe-diagnostics";

interface CompleteOfflineAccountCreationOptions {
  analytics: DiagnosticCaptureClient | null | undefined;
  analyticsProperties: Record<string, unknown>;
  invalidateAccounts: () => Promise<void>;
  closeModal: () => void;
  resetForm: () => void;
  notifySuccess: () => void;
  onSuccess?: () => void | Promise<void>;
}

export async function completeOfflineAccountCreation({
  analytics,
  analyticsProperties,
  invalidateAccounts,
  closeModal,
  resetForm,
  notifySuccess,
  onSuccess,
}: CompleteOfflineAccountCreationOptions): Promise<void> {
  safePostHogCapture(analytics, "account_added_manual", analyticsProperties);
  await invalidateAccounts();
  closeModal();
  resetForm();
  notifySuccess();
  await onSuccess?.();
}

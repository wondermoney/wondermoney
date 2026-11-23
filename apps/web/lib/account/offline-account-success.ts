interface CompleteOfflineAccountCreationOptions {
  invalidateAccounts: () => Promise<void>;
  closeModal: () => void;
  resetForm: () => void;
  notifySuccess: () => void;
  onSuccess?: () => void | Promise<void>;
}

export async function completeOfflineAccountCreation({
  invalidateAccounts,
  closeModal,
  resetForm,
  notifySuccess,
  onSuccess,
}: CompleteOfflineAccountCreationOptions): Promise<void> {
  await invalidateAccounts();
  closeModal();
  resetForm();
  notifySuccess();
  await onSuccess?.();
}

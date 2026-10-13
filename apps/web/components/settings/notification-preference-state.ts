import type {
  EmailCategoryPreferenceState,
  EmailNotificationStreamState,
  UpdateEmailNotificationPreferencesInput,
} from "@/lib/api/email-notification-preferences/types";

export type NotificationPreferenceStatus = "active" | "paused" | "off";
export type NotificationPreferencePauseReason =
  | "delivery"
  | "marketingOptOut"
  | "generic"
  | null;

/** Every optional email category rendered as a toggle, including the two pre-existing "streams". */
export type NotificationStream =
  | "budgetAlerts"
  | "weeklyInsights"
  | "accountRecovery";

/** `budgetAlerts`/`weeklyInsights` carry `deliverySupported`; the other categories don't gate on deliverability. */
export type NotificationPreference =
  | EmailNotificationStreamState
  | EmailCategoryPreferenceState;

export interface NotificationPreferenceViewState {
  status: NotificationPreferenceStatus;
  pauseReason: NotificationPreferencePauseReason;
  canEnable: boolean;
  canChange: boolean;
}

const STREAM_PATCH_FIELD: Record<
  NotificationStream,
  keyof UpdateEmailNotificationPreferencesInput
> = {
  budgetAlerts: "budgetAlertsEnabled",
  weeklyInsights: "weeklyInsightsEnabled",
  accountRecovery: "accountRecoveryEnabled",
};

export function getNotificationPreferenceViewState(
  preference: NotificationPreference,
  isMarketingOptedOut: boolean,
): NotificationPreferenceViewState {
  const deliverySupported =
    "deliverySupported" in preference ? preference.deliverySupported : true;
  const canEnable = deliverySupported;
  const canChange = preference.storedEnabled || canEnable;

  if (!preference.storedEnabled) {
    return {
      status: "off",
      pauseReason: getPauseReason(
        preference,
        deliverySupported,
        isMarketingOptedOut,
      ),
      canEnable,
      canChange,
    };
  }

  if (preference.effectiveEnabled) {
    return {
      status: "active",
      pauseReason: null,
      canEnable,
      canChange,
    };
  }

  return {
    status: "paused",
    pauseReason: getPauseReason(
      preference,
      deliverySupported,
      isMarketingOptedOut,
    ),
    canEnable,
    canChange,
  };
}

export function buildNotificationPreferencePatch(
  stream: NotificationStream,
  enabled: boolean,
): UpdateEmailNotificationPreferencesInput {
  return { [STREAM_PATCH_FIELD[stream]]: enabled };
}

function getPauseReason(
  preference: NotificationPreference,
  deliverySupported: boolean,
  isMarketingOptedOut: boolean,
): NotificationPreferencePauseReason {
  if (!deliverySupported) return "delivery";
  if (!preference.storedEnabled || preference.effectiveEnabled) return null;
  return isMarketingOptedOut ? "marketingOptOut" : "generic";
}

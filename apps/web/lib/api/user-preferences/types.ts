import type { DashboardLayoutEntry } from "@wondermoney/shared/dashboard-layout";

/** `GET`/`PATCH /v1/user/me/preferences`. Keys are added here as features need them. */
export interface UserPreferences {
  /**
   * The person turned every AI feature off for their account. Absent from an
   * API that predates the setting, which reads as not hidden.
   */
  aiHidden?: boolean;
  previewFeatures: boolean;
  /**
   * The home sections' order and visibility, shared with mobile. Absent from an
   * API that predates the layout, and empty when the person has not arranged
   * anything: both mean the default order.
   */
  dashboardLayout?: DashboardLayoutEntry[];
}

/** A partial update: only the keys present are changed. */
export interface UpdateUserPreferencesInput {
  aiHidden?: boolean;
  previewFeatures?: boolean;
  dashboardLayout?: DashboardLayoutEntry[];
}

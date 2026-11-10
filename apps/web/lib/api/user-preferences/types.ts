/** `GET`/`PATCH /v1/user/me/preferences`. Keys are added here as features need them. */
export interface UserPreferences {
  previewFeatures: boolean;
}

/** A partial update: only the keys present are changed. */
export interface UpdateUserPreferencesInput {
  previewFeatures?: boolean;
}

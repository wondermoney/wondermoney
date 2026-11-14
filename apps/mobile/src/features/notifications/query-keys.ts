export const notificationPreferencesKey = (epochId: number) => (
  ['notification-preferences', epochId] as const
)

export const pushPreferencesKey = (epochId: number) => (
  ['push-preferences', epochId] as const
)

export const notificationPreferencesKey = (epochId: number) => (
  ['notification-preferences', epochId] as const
)

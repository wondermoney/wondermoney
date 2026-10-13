export function getAuthUserFullName(user: undefined | { name?: null | string }): string | undefined {
  const trimmed = user?.name?.trim();
  return trimmed ? trimmed : undefined;
}

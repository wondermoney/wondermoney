export function getCreatableQuery(query: string): string | null {
  const trimmedQuery = query.trim();
  return trimmedQuery.length > 0 ? trimmedQuery : null;
}

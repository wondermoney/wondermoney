export function getBearerToken(authorizationHeader: string | string[] | undefined): null | string {
  if (typeof authorizationHeader !== 'string') {
    return null;
  }

  const trimmedHeader = authorizationHeader.trim();
  if (!trimmedHeader.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  return trimmedHeader.slice('Bearer '.length).trim() || null;
}

/**
 * The API address for requests the web server makes itself: SSR data fetching, the session
 * check and the auth-complete route handler.
 *
 * `NEXT_PUBLIC_API_URL` is the address browsers use. It is not always reachable from the web
 * server: in the self-hosting compose file it is http://localhost:3001, which inside the web
 * container is the web container. `API_INTERNAL_URL` (http://api:3001 there) is the address on
 * the server's own network. It is a server-only variable, read at run time rather than inlined
 * at build time, so it takes effect without rebuilding the image.
 */
type Env = Readonly<Record<string, string | undefined>>;

export function resolveServerApiUrl(env: Env): string {
  const url =
    env.API_INTERNAL_URL?.trim() ||
    env.NEXT_PUBLIC_API_URL?.trim() ||
    "http://localhost:3001";
  return url.replace(/\/+$/u, "");
}

export const getServerApiUrl = (): string =>
  resolveServerApiUrl({
    API_INTERNAL_URL: process.env.API_INTERNAL_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  });

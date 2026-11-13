/**
 * The mobile push switch.
 *
 * `PUSH_ENABLED=true` (or `1`, `on`, `yes`) lets the mobile app register devices and lets the API
 * and worker send notifications through the Expo push service (`services/push`), and reports
 * `features.push: true` on `GET /v1/instance`. Anything else, unset included, leaves it off: no
 * device is registered and nothing is sent. Off by default because it sends to an outside service.
 *
 * `EXPO_ACCESS_TOKEN` is sent as a bearer token on every push request, for an Expo project that
 * requires one ("enhanced security for push notifications"). Optional.
 */
export function expoAccessToken(env: Readonly<Record<string, string | undefined>> = process.env): null | string {
  return env['EXPO_ACCESS_TOKEN']?.trim() || null;
}

export function isPushEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const value = env['PUSH_ENABLED']?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on' || value === 'yes';
}

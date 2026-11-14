/**
 * The public demo's instance switch.
 *
 * `DEMO_SIGN_IN_ENABLED=true` (or `1`, `on`, `yes`) opens `POST /v1/auth/demo`, which signs a
 * visitor in to the shared read-only demo account without a password, and reports
 * `features.demo: true` on `GET /v1/instance`. Anything else, unset included, leaves it off: the
 * route answers 404 and the clients show no "Try the demo" button. Off by default because the
 * endpoint hands out a session to anyone who asks.
 */
export function isDemoSignInEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const value = env['DEMO_SIGN_IN_ENABLED']?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on' || value === 'yes';
}

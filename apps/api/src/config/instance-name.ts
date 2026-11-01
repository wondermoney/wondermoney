type Env = Readonly<Record<string, string | undefined>>;

/** What the hosted service calls itself, and what an instance without `INSTANCE_NAME` is called. */
const DEFAULT_INSTANCE_NAME = 'WonderMoney';

/**
 * This instance's display name (`INSTANCE_NAME`): `GET /v1/instance`, email subjects, copy and
 * sign-offs, and the authenticator-app label all use it.
 */
export function instanceName(env: Env = process.env): string {
  return env['INSTANCE_NAME']?.trim() || DEFAULT_INSTANCE_NAME;
}

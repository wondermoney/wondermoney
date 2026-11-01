/**
 * Where this instance's web app and API live: `APP_URL` and `API_URL` (the latter falls back to
 * `BETTER_AUTH_URL`, which is the same address). Links in emails, OAuth and bank-connection
 * redirects, and the default CORS/CSRF allow-lists all derive from them.
 *
 * Development defaults to the local dev servers. A deployed environment (staging or
 * production) must set both: without them every link would point somewhere wrong, so the
 * process refuses to start instead.
 */

export type AppEnvironment = 'development' | 'production' | 'staging';

type Env = Readonly<Record<string, string | undefined>>;

const LOCAL_DEV_ORIGINS = ['http://localhost:8080', 'http://localhost:3000', 'http://localhost:3001', 'http://localhost:4321'] as const;

const read = (env: Env, key: string): null | string => env[key]?.trim().replace(/\/+$/u, '') || null;

function required(value: null | string, name: string, appEnv: AppEnvironment): string {
  if (value) return value;
  throw new Error(`${name} must be set when APP_ENV is ${appEnv} (the public address of ${name === 'APP_URL' ? 'the web app' : 'this API'}).`);
}

/** The web app's address (`APP_URL`). */
export function resolveAppUrl(env: Env, appEnv: AppEnvironment): string {
  const appUrl = read(env, 'APP_URL');
  return appEnv === 'development' ? appUrl ?? 'http://localhost:3000' : required(appUrl, 'APP_URL', appEnv);
}

/** The API's address (`API_URL`, else `BETTER_AUTH_URL`). */
export function resolveInstanceUrls(env: Env, appEnv: AppEnvironment): { apiUrl: string; appUrl: string } {
  return { apiUrl: resolveApiUrl(env, appEnv), appUrl: resolveAppUrl(env, appEnv) };
}

function resolveApiUrl(env: Env, appEnv: AppEnvironment): string {
  const apiUrl = read(env, 'API_URL') ?? read(env, 'BETTER_AUTH_URL');
  return appEnv === 'development' ? apiUrl ?? 'http://localhost:3001' : required(apiUrl, 'API_URL', appEnv);
}

/** Browser origins allowed by default: the app, plus the local dev servers outside production. */
export function defaultBrowserOrigins(appEnv: AppEnvironment, appUrl: string): string[] {
  const appOrigin = toOrigin(appUrl);
  const origins = appEnv === 'production' ? [appOrigin] : [...LOCAL_DEV_ORIGINS, appOrigin];
  return [...new Set(origins.filter(Boolean))];
}

function toOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

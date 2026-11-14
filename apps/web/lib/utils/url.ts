import { instanceConfig } from "@/lib/instance";

const getBaseUrl = () => {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_VERCEL_URL ??
    "http://localhost:3000"
  );
};

// Google OAuth's `signIn.social` completes server-side (the API mounts
// better-auth's `/api/auth/callback/google`, which sets the session cookie),
// then redirects the browser to this `callbackURL`. `/auth/complete` is the
// web route that provisions the Appuser and does the final app redirect —
// there is no PKCE `code` for the web app to exchange itself, so this no
// longer points at the (now-removed) `/auth/callback` route.
const getCallbackURL = (locale: string = "en") => {
  return `${getBaseUrl()}/${locale}/auth/complete`;
};

const getResetPasswordCallbackURL = (locale: string = "en") => {
  return `${getBaseUrl()}/${locale}/auth/reset`;
};

// Where the verification link in the sign-up email lands. Its locale also tells the API which
// language to write that email in, since the account (and its language) does not exist yet.
const getEmailVerificationCallbackURL = (locale: string = "en") => {
  return `${getBaseUrl()}/${locale}`;
};

/** The auth cookie's `Domain` attribute: see `lib/instance.ts`. */
const getCookiesDomain = () => instanceConfig.cookieDomain;

export {
  getBaseUrl,
  getCallbackURL,
  getCookiesDomain,
  getEmailVerificationCallbackURL,
  getResetPasswordCallbackURL,
};

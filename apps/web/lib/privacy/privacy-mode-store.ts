/**
 * Privacy mode's device-local state.
 *
 * Kept in a first-party cookie rather than `localStorage` so the server can
 * read it too: the layout renders the first paint already masked, so a reload
 * never flashes real balances and the real figures never reach the HTML. The
 * cookie is only a display preference; nothing on the API reads it, and it is
 * not synced across devices.
 */
export const PRIVACY_MODE_COOKIE = "wm-privacy-mode";

/** A year: "remember on this device", renewed on every toggle. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const CHANGE_EVENT = "wm:privacy-mode-change";

/** The cookie value as the server reads it (`cookies().get(...)?.value`). */
export function isPrivacyModeValue(value: string | undefined | null): boolean {
  return value === "1";
}

export function readPrivacyMode(): boolean {
  if (typeof document === "undefined") return false;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PRIVACY_MODE_COOKIE}=`));
  return isPrivacyModeValue(match?.slice(PRIVACY_MODE_COOKIE.length + 1));
}

export function writePrivacyMode(hidden: boolean): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = hidden
    ? `${PRIVACY_MODE_COOKIE}=1; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax${secure}`
    : `${PRIVACY_MODE_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Cookies fire no event, so this listens for its own change event (this tab)
 * and re-reads on focus and visibility (another tab may have toggled).
 */
export function subscribePrivacyMode(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onVisibility = () => {
    if (document.visibilityState === "visible") onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

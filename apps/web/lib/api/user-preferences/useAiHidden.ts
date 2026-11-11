import useUserPreferences from "./useUserPreferences";

/**
 * Whether this person turned every AI feature off for their account.
 *
 * The preference is the one the Settings › Privacy switch writes. It defaults
 * to false while the document loads, so an AI entry point is not hidden from
 * someone who never turned it off; the API refuses the call either way.
 */
export default function useAiHidden(): boolean {
  const preferences = useUserPreferences();
  return preferences.data?.aiHidden ?? false;
}

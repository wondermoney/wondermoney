import useUserPreferences from "../user-preferences/useUserPreferences";

/**
 * True when the signed-in user has turned on preview features.
 *
 * Off while the preference is loading or if it cannot be read, so a preview
 * entry point never flashes for someone who does not have the flag. Gate the
 * entry point with `<PreviewGate>` and the API route with
 * `requirePreviewFeatures`; this hook is the client half of that gate.
 */
export function usePreviewFeatures(): boolean {
  const { data } = useUserPreferences();
  return data?.previewFeatures ?? false;
}

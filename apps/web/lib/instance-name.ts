/**
 * The instance's name: the API's `INSTANCE_NAME`, returned by `GET /v1/instance`. It names the
 * browser tab, the wordmark and the copy that says whose server the user is on. Product copy
 * that describes what the software does ("WonderMoney cannot move money") keeps the product's
 * own name.
 */
export const DEFAULT_INSTANCE_NAME = "WonderMoney";

/** A usable name from whatever the API sent: trimmed, or the default when blank or missing. */
export function normalizeInstanceName(name: unknown): string {
  return typeof name === "string" && name.trim()
    ? name.trim()
    : DEFAULT_INSTANCE_NAME;
}

/** True for the hosted service and any instance that kept the default name. */
export const isDefaultInstanceName = (name: string): boolean =>
  name === DEFAULT_INSTANCE_NAME;

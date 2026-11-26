/**
 * Some tests resolve files relative to `process.cwd()`. Vitest workers inherit
 * the cwd of whoever started the run, which is the project root for `pnpm test`
 * but the current directory for a bare `npx vitest` fired from a subdirectory.
 * Pinning it here means they read the same files however the run was launched.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { vi } from "vitest";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

if (process.cwd() !== projectRoot) {
  process.chdir(projectRoot);
}

/**
 * better-auth's hooks (`authClient.useSession()` and any other `use*` atom
 * hook) are inert in tests: they answer from a fixed value and never subscribe
 * to better-auth's nanostores.
 *
 * Subscribing mounts the session atom, which fetches `/get-session` from the
 * API and starts a refresh manager that listens on `window`. When the last
 * component unmounts, nanostores tears that down on a one-second timer. A file
 * that unmounts in its last second leaves the timer running into jsdom's
 * teardown, where `window.removeEventListener` is gone, and the worker reports
 * `target.removeEventListener is not a function` against a file that passed
 * (#744). Any component that reaches the real client could do it, so it is
 * stopped here once rather than mocked file by file.
 *
 * `useSession()` reads as signed out, which is what the real hook ends at with
 * no API behind it. The rest of the client (sign-in, sign-out, getSession,
 * plugins) stays real. A file that mocks `@/lib/auth/client` never builds a
 * client, so its own mock wins. A file that needs the real hooks opts out with
 * `vi.unmock("better-auth/react")`.
 */
vi.mock("better-auth/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("better-auth/react")>();

  const signedOut = Object.freeze({
    data: null,
    error: null,
    isPending: false,
    isRefetching: false,
    refetch: async () => {},
  });

  const createAuthClient = (
    ...args: Parameters<typeof actual.createAuthClient>
  ) => {
    const client = actual.createAuthClient(...args);
    const atoms = client.$store.atoms as Record<string, { value: unknown }>;
    // createAuthClient names each atom's hook `use` + the capitalised key.
    const inertHooks = new Map<string, () => unknown>(
      Object.entries(atoms).map(([key, atom]) => [
        `use${key.charAt(0).toUpperCase()}${key.slice(1)}`,
        // `.value` reads the store without mounting it; `.get()` would mount it.
        () => atom.value,
      ]),
    );
    inertHooks.set("useSession", () => signedOut);

    return new Proxy(client, {
      get(target, property, receiver) {
        if (typeof property === "string") {
          const hook = inertHooks.get(property);
          if (hook) return hook;
        }
        return Reflect.get(target, property, receiver);
      },
    });
  };

  return {
    ...actual,
    createAuthClient: createAuthClient as typeof actual.createAuthClient,
  };
});

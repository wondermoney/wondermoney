// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, test } from "vitest";

import { authClient } from "@/lib/auth/client";
import { useUser } from "@/lib/auth/user-context";

/*
 * vitest.setup.ts keeps better-auth's hooks off its nanostores (#744). The real
 * session hook would mount the session store, start a refresh manager on
 * `window`, and leave a one-second unmount timer that can outlive jsdom. This
 * file builds the real client, as any test that renders a signed-in component
 * without mocking `@/lib/auth/client` does.
 */

const kBroadcastChannel = Symbol.for("better-auth:broadcast-channel");

function SignedInAs() {
  const user = useUser();
  return <p>{user ? user.email : "signed out"}</p>;
}

afterEach(() => {
  cleanup();
});

test("useSession reads as signed out without subscribing to the session store", () => {
  render(<SignedInAs />);

  screen.getByText("signed out");
  assert.equal(authClient.$store.atoms.session.lc, 0);
});

test("rendering and unmounting starts no session refresh, so no timer is left for after teardown", () => {
  render(<SignedInAs />);
  cleanup();

  // The refresh manager creates this channel when the session store mounts.
  assert.equal((globalThis as Record<symbol, unknown>)[kBroadcastChannel], undefined);
});

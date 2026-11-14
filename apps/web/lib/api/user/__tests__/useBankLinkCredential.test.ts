import assert from "node:assert/strict";

import { test } from "vitest";

import { resolveBankLinkCredential } from "../useBankLinkCredential";

const settled = {
  callerCredentials: "user" as const,
  callerLoading: false,
  instanceCredentials: "user" as const,
  ownCredentialActive: false,
  ownCredentialLoading: false,
};

test("a user without a key whose household may use the server's shared one skips the credential step", () => {
  const state = resolveBankLinkCredential({ ...settled, callerCredentials: "instance", instanceCredentials: "instance" });

  assert.deepEqual(state, { canLink: true, credentialRequired: false, loading: false, sharedCredentialUnavailable: false });
});

test("the shared credential is enough while the user's own key is still loading", () => {
  const state = resolveBankLinkCredential({ ...settled, callerCredentials: "instance", ownCredentialLoading: true });

  assert.equal(state.canLink, true);
});

test("an active key of the user's own is enough, whatever the server offers", () => {
  const state = resolveBankLinkCredential({ ...settled, callerLoading: true, ownCredentialActive: true });

  assert.deepEqual(state, { canLink: true, credentialRequired: false, loading: false, sharedCredentialUnavailable: false });
});

test("without either, the credential step shows", () => {
  const state = resolveBankLinkCredential(settled);

  assert.deepEqual(state, { canLink: false, credentialRequired: true, loading: false, sharedCredentialUnavailable: false });
});

test("a household the shared credential does not cover is told why it needs its own key", () => {
  const state = resolveBankLinkCredential({ ...settled, instanceCredentials: "instance" });

  assert.equal(state.credentialRequired, true);
  assert.equal(state.sharedCredentialUnavailable, true);
});

test("nothing is decided while either answer is still loading", () => {
  for (const loading of [{ ownCredentialLoading: true }, { callerLoading: true }]) {
    const state = resolveBankLinkCredential({ ...settled, ...loading });

    assert.deepEqual(state, { canLink: false, credentialRequired: false, loading: true, sharedCredentialUnavailable: false });
  }
});

test("an older API without the per-caller answer behaves as before: the user's own key decides", () => {
  const state = resolveBankLinkCredential({ ...settled, callerCredentials: undefined, instanceCredentials: undefined });

  assert.equal(state.credentialRequired, true);
  assert.equal(state.sharedCredentialUnavailable, false);
});

import assert from "node:assert/strict";

import { afterEach, test } from "vitest";

import { householdQueryKeys } from "../queryKeys";
import type {
  CreateHouseholdInviteResponse,
  HouseholdResponse,
} from "../types";
import {
  createHouseholdInvite,
  getCreateHouseholdInviteMutationOptions,
  type HouseholdInvitePostClient,
} from "../useCreateHouseholdInvite";
import { getHousehold, type HouseholdGetClient } from "../useHousehold";
import {
  getRemoveHouseholdMemberMutationOptions,
  type HouseholdMemberDeleteClient,
  removeHouseholdMember,
} from "../useRemoveHouseholdMember";
import {
  type HouseholdResendClient,
  resendHouseholdInvite,
} from "../useResendHouseholdInvite";
import {
  getRevokeHouseholdInviteMutationOptions,
  type HouseholdDeleteClient,
  revokeHouseholdInvite,
} from "../useRevokeHouseholdInvite";
import { validateInvite } from "../validateInvite";

const household: HouseholdResponse = {
  members: [
    { appuserKey: 1, emailAddress: "owner@x.com", firstName: "Di", role: "owner" },
    { appuserKey: 2, emailAddress: "partner@x.com", role: "member" },
  ],
  pendingInvite: null,
};

const inviteResponse: CreateHouseholdInviteResponse = {
  invite: {
    email: "partner@x.com",
    expiresAt: "2026-08-09T00:00:00.000Z",
    householdInviteKey: 7,
    status: "pending",
  },
};

// Records invalidateQueries calls; enough of QueryClient for the option factories.
const recordingCache = () => {
  const invalidated: unknown[] = [];
  return {
    invalidated,
    invalidateQueries: (arg?: unknown) => {
      invalidated.push(arg);
      return Promise.resolve();
    },
  };
};

// The option factories type onSuccess with TanStack's full generic signature;
// invoke it loosely — we only care that it triggers the invalidation.
const fireOnSuccess = (options: { onSuccess?: unknown }) =>
  (options.onSuccess as (...args: unknown[]) => unknown)(
    undefined,
    undefined,
    undefined,
    undefined,
  );

test("getHousehold reads /v1/household through the injectable client", async () => {
  const urls: string[] = [];
  const client = {
    get: async (url: string) => {
      urls.push(url);
      return { data: household };
    },
  } as HouseholdGetClient;

  assert.equal(await getHousehold(client), household);
  assert.deepEqual(urls, ["/v1/household"]);
});

test("createHouseholdInvite POSTs the email; onSuccess invalidates the household query", async () => {
  const calls: Array<{ url: string; input: unknown }> = [];
  const client = {
    post: async (url: string, input: unknown) => {
      calls.push({ url, input });
      return { data: inviteResponse };
    },
  } as HouseholdInvitePostClient;

  assert.equal(
    await createHouseholdInvite({ email: "partner@x.com" }, client),
    inviteResponse,
  );
  assert.deepEqual(calls, [
    { url: "/v1/household/invites", input: { email: "partner@x.com" } },
  ]);

  const cache = recordingCache();
  await fireOnSuccess(getCreateHouseholdInviteMutationOptions(cache, client));
  assert.deepEqual(cache.invalidated, [{ queryKey: householdQueryKeys.all }]);
});

test("revokeHouseholdInvite DELETEs the invite by id", async () => {
  const urls: string[] = [];
  const client = {
    delete: async (url: string) => {
      urls.push(url);
      return { data: undefined };
    },
  } as HouseholdDeleteClient;

  await revokeHouseholdInvite(7, client);
  assert.deepEqual(urls, ["/v1/household/invites/7"]);

  const cache = recordingCache();
  await fireOnSuccess(getRevokeHouseholdInviteMutationOptions(cache, client));
  assert.deepEqual(cache.invalidated, [{ queryKey: householdQueryKeys.all }]);
});

test("resendHouseholdInvite POSTs to the resend sub-route", async () => {
  const urls: string[] = [];
  const client = {
    post: async (url: string) => {
      urls.push(url);
      return { data: inviteResponse };
    },
  } as HouseholdResendClient;

  await resendHouseholdInvite(7, client);
  assert.deepEqual(urls, ["/v1/household/invites/7/resend"]);
});

test("removeHouseholdMember DELETEs the member; onSuccess invalidates all queries", async () => {
  const urls: string[] = [];
  const client = {
    delete: async (url: string) => {
      urls.push(url);
      return { data: undefined };
    },
  } as HouseholdMemberDeleteClient;

  await removeHouseholdMember(2, client);
  assert.deepEqual(urls, ["/v1/household/members/2"]);

  const cache = recordingCache();
  await fireOnSuccess(getRemoveHouseholdMemberMutationOptions(cache, client));
  // remove/leave reshapes the whole picture → invalidate everything (no key).
  assert.deepEqual(cache.invalidated, [undefined]);
});

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("validateInvite returns the parsed body on a 200", async () => {
  const view = {
    email: "partner@x.com",
    expiresAt: "2026-08-09T00:00:00.000Z",
    inviterName: "Di",
  };
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => view,
  })) as unknown as typeof fetch;

  assert.deepEqual(await validateInvite("tok"), view);
});

test("validateInvite returns null on a non-ok response", async () => {
  globalThis.fetch = (async () => ({
    ok: false,
    json: async () => ({}),
  })) as unknown as typeof fetch;
  assert.equal(await validateInvite("bad"), null);
});

test("validateInvite returns null when fetch throws", async () => {
  globalThis.fetch = (async () => {
    throw new Error("network");
  }) as unknown as typeof fetch;
  assert.equal(await validateInvite("tok"), null);
});

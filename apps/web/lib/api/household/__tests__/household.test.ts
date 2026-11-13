import assert from "node:assert/strict";

import { afterEach, test } from "vitest";

import { householdQueryKeys } from "../queryKeys";
import type {
  CreateHouseholdInviteResponse,
  HouseholdResponse,
} from "../types";
import {
  acceptHouseholdInvite,
  getAcceptHouseholdInviteMutationOptions,
  type HouseholdAcceptClient,
} from "../useAcceptHouseholdInvite";
import {
  createHouseholdInvite,
  getCreateHouseholdInviteMutationOptions,
  type HouseholdInvitePostClient,
} from "../useCreateHouseholdInvite";
import {
  getHousehold,
  type HouseholdGetClient,
  normalizeHousehold,
} from "../useHousehold";
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
import {
  getTransferHouseholdOwnershipMutationOptions,
  type HouseholdTransferClient,
  transferHouseholdOwnership,
} from "../useTransferHouseholdOwnership";
import {
  getUpdateHouseholdMemberRoleMutationOptions,
  type HouseholdMemberPatchClient,
  updateHouseholdMemberRole,
} from "../useUpdateHouseholdMemberRole";
import { validateInvite } from "../validateInvite";

const household: HouseholdResponse = {
  members: [
    { appuserKey: 1, emailAddress: "owner@x.com", firstName: "Di", role: "owner" },
    { appuserKey: 2, emailAddress: "member@x.com", role: "member" },
  ],
  maxMembers: 6,
  pendingInvites: [
    {
      email: "viewer@x.com",
      expiresAt: "2026-08-09T00:00:00.000Z",
      householdInviteKey: 7,
      role: "viewer",
    },
  ],
  viewerAppuserKey: 1,
};

const inviteResponse: CreateHouseholdInviteResponse = {
  invite: {
    email: "member@x.com",
    expiresAt: "2026-08-09T00:00:00.000Z",
    householdInviteKey: 7,
    role: "admin",
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

  assert.deepEqual(await getHousehold(client), {
    maxMembers: 6,
    members: household.members,
    pendingInvites: household.pendingInvites,
    viewerAppuserKey: 1,
  });
  assert.deepEqual(urls, ["/v1/household"]);
});

test("normalizeHousehold falls back to the deprecated single invite from an older API", () => {
  const legacy = normalizeHousehold({
    members: household.members,
    pendingInvite: {
      email: "old@x.com",
      expiresAt: "2026-08-09T00:00:00.000Z",
      householdInviteKey: 3,
    },
  });
  assert.deepEqual(legacy.pendingInvites, [
    {
      email: "old@x.com",
      expiresAt: "2026-08-09T00:00:00.000Z",
      householdInviteKey: 3,
      role: "member",
    },
  ]);
  assert.equal(legacy.viewerAppuserKey, null);
  // Before roles a household was the owner and one partner.
  assert.equal(legacy.maxMembers, 2);

  // The list wins over the deprecated field when both are present.
  const current = normalizeHousehold({
    ...household,
    pendingInvite: { ...household.pendingInvites![0]! },
  });
  assert.deepEqual(current.pendingInvites, household.pendingInvites);
  assert.deepEqual(
    normalizeHousehold({ members: [], pendingInvite: null }).pendingInvites,
    [],
  );
});

test("updateHouseholdMemberRole PATCHes the member with the role; onSuccess invalidates the household", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const client = {
    patch: async (url: string, body: unknown) => {
      calls.push({ url, body });
      return { data: { member: household.members[1] } };
    },
  } as HouseholdMemberPatchClient;

  await updateHouseholdMemberRole({ appuserKey: 2, role: "viewer" }, client);
  assert.deepEqual(calls, [
    { url: "/v1/household/members/2", body: { role: "viewer" } },
  ]);

  const cache = recordingCache();
  await fireOnSuccess(getUpdateHouseholdMemberRoleMutationOptions(cache, client));
  assert.deepEqual(cache.invalidated, [{ queryKey: householdQueryKeys.all }]);
});

test("transferHouseholdOwnership POSTs the new owner; onSuccess stores the household and invalidates everything", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const client = {
    post: async (url: string, body: unknown) => {
      calls.push({ url, body });
      return { data: household };
    },
  } as HouseholdTransferClient;

  const result = await transferHouseholdOwnership(2, client);
  assert.deepEqual(calls, [
    { url: "/v1/household/transfer-ownership", body: { appuserKey: 2 } },
  ]);
  assert.equal(result.pendingInvites.length, 1);

  const stored: unknown[] = [];
  const cache = {
    ...recordingCache(),
    setQueryData: (key: unknown, value: unknown) => {
      stored.push([key, value]);
      return value;
    },
  };
  const options = getTransferHouseholdOwnershipMutationOptions(
    cache as never,
    client,
  );
  await (options.onSuccess as (...args: unknown[]) => unknown)(
    result,
    2,
    undefined,
    undefined,
  );
  assert.deepEqual(stored, [[householdQueryKeys.all, result]]);
  // The caller is no longer the owner anywhere in the app.
  assert.deepEqual(cache.invalidated, [undefined]);
});

test("acceptHouseholdInvite POSTs to the token's accept route with no body; success reloads the app home", async () => {
  const calls: unknown[][] = [];
  const client = {
    post: async (...args: unknown[]) => {
      calls.push(args);
      return { data: undefined };
    },
  } as HouseholdAcceptClient;

  await acceptHouseholdInvite("a/b c", client);
  assert.deepEqual(calls, [["/v1/household/invites/a%2Fb%20c/accept"]]);

  const reloaded: string[] = [];
  const options = getAcceptHouseholdInviteMutationOptions("pt", client, (locale) =>
    reloaded.push(locale),
  );
  await fireOnSuccess(options);
  assert.deepEqual(reloaded, ["pt"]);
});

test("createHouseholdInvite POSTs the email and role; onSuccess invalidates the household query", async () => {
  const calls: Array<{ url: string; input: unknown }> = [];
  const client = {
    post: async (url: string, input: unknown) => {
      calls.push({ url, input });
      return { data: inviteResponse };
    },
  } as HouseholdInvitePostClient;

  assert.equal(
    await createHouseholdInvite({ email: "member@x.com", role: "admin" }, client),
    inviteResponse,
  );
  assert.deepEqual(calls, [
    {
      url: "/v1/household/invites",
      input: { email: "member@x.com", role: "admin" },
    },
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
    email: "member@x.com",
    expiresAt: "2026-08-09T00:00:00.000Z",
    householdName: "The Silvas",
    inviterName: "Di",
    role: "viewer",
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

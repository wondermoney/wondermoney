import assert from "node:assert/strict";

import { test } from "vitest";

import {
  deleteEnableBankingCredential,
  type EnableBankingCredentialDeleteClient,
  type EnableBankingCredentialGetClient,
  type EnableBankingCredentialPostClient,
  enableBankingCredentialQueryKeys,
  getDeleteEnableBankingCredentialMutationOptions,
  getEnableBankingCredential,
  getSaveEnableBankingCredentialMutationOptions,
  saveEnableBankingCredential,
  type SaveEnableBankingCredentialResponse,
} from "../useEnableBankingCredential";

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

test("getEnableBankingCredential reads the credential through the injectable client", async () => {
  const urls: string[] = [];
  const client = {
    get: async (url: string) => {
      urls.push(url);
      return {
        data: {
          applicationId: "app-1",
          status: "active",
          lastValidatedAt: "2026-09-01T00:00:00.000Z",
          lastValidationError: null,
        },
      };
    },
  } as EnableBankingCredentialGetClient;

  const result = await getEnableBankingCredential(client);
  assert.deepEqual(urls, ["/v1/user/enable-banking-credential"]);
  assert.equal(result?.applicationId, "app-1");
  assert.equal(result?.status, "active");
});

test("getEnableBankingCredential returns null when the user has no credential configured", async () => {
  const client = {
    get: async () => ({ data: null }),
  } as EnableBankingCredentialGetClient;

  assert.equal(await getEnableBankingCredential(client), null);
});

test("saveEnableBankingCredential POSTs applicationId + privateKeyPem; onSuccess invalidates the query", async () => {
  const calls: Array<{ url: string; input: unknown }> = [];
  const response: SaveEnableBankingCredentialResponse = {
    applicationId: "app-1",
    status: "active",
    lastValidatedAt: "2026-09-01T00:00:00.000Z",
  };
  const client = {
    post: async (url: string, input: unknown) => {
      calls.push({ url, input });
      return { data: response };
    },
  } as EnableBankingCredentialPostClient;

  const input = {
    applicationId: "app-1",
    privateKeyPem: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
  };

  assert.equal(await saveEnableBankingCredential(input, client), response);
  assert.deepEqual(calls, [
    { url: "/v1/user/enable-banking-credential", input },
  ]);

  const cache = recordingCache();
  await fireOnSuccess(
    getSaveEnableBankingCredentialMutationOptions(cache, client),
  );
  assert.deepEqual(cache.invalidated, [
    { queryKey: enableBankingCredentialQueryKeys.all },
  ]);
});

test("deleteEnableBankingCredential DELETEs the credential; onSuccess invalidates the query", async () => {
  const urls: string[] = [];
  const client = {
    delete: async (url: string) => {
      urls.push(url);
      return { data: undefined };
    },
  } as EnableBankingCredentialDeleteClient;

  await deleteEnableBankingCredential(client);
  assert.deepEqual(urls, ["/v1/user/enable-banking-credential"]);

  const cache = recordingCache();
  await fireOnSuccess(
    getDeleteEnableBankingCredentialMutationOptions(cache, client),
  );
  assert.deepEqual(cache.invalidated, [
    { queryKey: enableBankingCredentialQueryKeys.all },
  ]);
});

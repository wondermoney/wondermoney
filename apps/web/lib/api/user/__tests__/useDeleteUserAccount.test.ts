import assert from "node:assert/strict";

import { test } from "vitest";

import { deleteUserAccount } from "../useDeleteUserAccount";

test("deletes the authenticated user account via /v1/user/me", async () => {
  const requestedUrls: string[] = [];
  const apiClient = {
    delete: async (url: string) => {
      requestedUrls.push(url);
      return { data: {} };
    },
  };

  await deleteUserAccount(apiClient);

  assert.deepEqual(requestedUrls, ["/v1/user/me"]);
});

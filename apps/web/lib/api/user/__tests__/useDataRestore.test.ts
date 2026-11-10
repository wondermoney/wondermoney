import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { uploadDataRestore, validateDataRestore } from "../useDataRestore";

const restore = {
  createdAt: "2026-11-09T10:00:00.000Z",
  encrypted: null,
  error: null,
  expiresAt: null,
  export: null,
  finishedAt: null,
  id: "user.data-restore:1",
  status: "awaiting_upload",
  summary: null,
  upload: {
    headers: { "Content-Type": "application/zip" },
    maxBytes: 64,
    method: "PUT",
    url: "https://files.example.test/files/data-restores/1/a.zip?signed",
  },
};

test("announces the file size, then puts the file straight to the signed link without credentials", async () => {
  const post = vi.fn().mockResolvedValue({ data: { restore } });
  const put = vi.fn().mockResolvedValue({});
  const file = new Blob(["zip bytes"], { type: "application/zip" });

  await uploadDataRestore(file, { get: vi.fn(), post } as never, put as never);

  assert.deepEqual(post.mock.calls[0], [
    "/v1/user/me/restores",
    { size: file.size },
  ]);
  assert.equal(put.mock.calls[0][0], restore.upload.url);
  assert.equal(put.mock.calls[0][1], file);
  assert.deepEqual(put.mock.calls[0][2], {
    headers: { "Content-Type": "application/zip" },
    withCredentials: false,
  });
});

test("sends the password in the request body, never in the URL", async () => {
  const post = vi.fn().mockResolvedValue({ data: { restore } });

  await validateDataRestore(
    "user.data-restore:1",
    { password: "a long enough backup password" },
    { get: vi.fn(), post } as never,
  );

  const [url, body] = post.mock.calls[0] as [string, unknown];
  assert.equal(url.includes("password"), false);
  assert.deepEqual(body, { password: "a long enough backup password" });
});

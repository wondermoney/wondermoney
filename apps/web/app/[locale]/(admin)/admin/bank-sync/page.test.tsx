// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import { AxiosError, AxiosHeaders, type AxiosInstance } from "axios";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, test, vi } from "vitest";

import enAdmin from "../../../../../messages/en/admin.json";

const { api, NOT_FOUND } = vi.hoisted(() => ({
  api: { get: vi.fn() },
  NOT_FOUND: new Error("NEXT_NOT_FOUND"),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND;
  },
}));
vi.mock("@/lib/api/api-server", () => ({
  getServerApi: () => Promise.resolve(api as unknown as AxiosInstance),
}));
// The shell and the privacy boundary are beside the point here.
vi.mock("@/components/layout/AppShell", () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid="shell">{children}</div>
  ),
}));
vi.mock("@/lib/privacy/PrivacyModeBoundary", () => ({
  PrivacyModeBoundary: ({ children }: { children: ReactNode }) => children,
}));

import AdminBankSyncPage from "./page";

const params = Promise.resolve({ locale: "en" });

function apiError(status: number) {
  return new AxiosError("failed", String(status), undefined, undefined, {
    config: { headers: new AxiosHeaders() },
    data: {},
    headers: {},
    status,
    statusText: String(status),
  });
}

const HEALTH = {
  connections: {
    byStatus: { authorized: 0, created: 0, error: 0, expired: 0, linked: 1 },
    failing: 0,
    total: 1,
  },
  failingThresholdHours: 48,
  generatedAt: "2026-11-12T12:00:00.000Z",
  incidentsByErrorCode: { last24Hours: [], last7Days: [] },
  institutions: [],
  successRateWindowDays: 7,
};
const FAILING = {
  connections: [],
  generatedAt: "2026-11-12T12:00:00.000Z",
  thresholdHours: 48,
};

beforeEach(() => {
  api.get.mockReset();
});
afterEach(cleanup);

test("a person the API does not treat as an instance admin gets the not-found page", async () => {
  api.get.mockRejectedValue(apiError(404));

  await assert.rejects(
    AdminBankSyncPage({ params }),
    (error) => error === NOT_FOUND,
  );
});

test("any other API failure is an error, not a not-found", async () => {
  api.get.mockRejectedValue(apiError(500));

  await assert.rejects(
    AdminBankSyncPage({ params }),
    (error) => error !== NOT_FOUND,
  );
});

test("an instance admin gets the health page inside the app shell", async () => {
  api.get.mockImplementation((path: string) =>
    Promise.resolve({ data: path.endsWith("/failing") ? FAILING : HEALTH }),
  );

  const page = await AdminBankSyncPage({ params });
  render(
    <NextIntlClientProvider locale="en" messages={enAdmin} timeZone="UTC">
      {page}
    </NextIntlClientProvider>,
  );

  screen.getByTestId("shell");
  screen.getByRole("heading", { level: 1, name: enAdmin.adminBankSync.title });
  assert.deepEqual(api.get.mock.calls.map(([path]) => path).sort(), [
    "/v1/admin/bank-sync/failing",
    "/v1/admin/bank-sync/health",
  ]);
});

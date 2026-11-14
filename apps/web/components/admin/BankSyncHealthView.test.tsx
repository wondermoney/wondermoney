// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test } from "vitest";

import type {
  BankSyncHealth,
  FailingBankConnections,
} from "@/lib/api/admin/bank-sync-health";

import enAdmin from "../../messages/en/admin.json";
import { BankSyncHealthView } from "./BankSyncHealthView";

afterEach(cleanup);

const copy = enAdmin.adminBankSync;

function health(overrides: Partial<BankSyncHealth> = {}): BankSyncHealth {
  return {
    connections: {
      byStatus: {
        authorized: 0,
        created: 1,
        error: 1,
        expired: 2,
        linked: 9,
        revoked: 4,
      },
      failing: 3,
      total: 17,
    },
    failingThresholdHours: 48,
    generatedAt: "2026-11-12T12:00:00.000Z",
    incidentsByErrorCode: {
      last24Hours: [{ errorCode: "rate_limited", incidents: 4 }],
      last7Days: [
        { errorCode: "consent_expired", incidents: 7 },
        { errorCode: "rate_limited", incidents: 5 },
      ],
    },
    institutions: [
      {
        attempts: 12,
        failed: 9,
        failingConnections: 2,
        institution: {
          country: "ES",
          id: "enable_banking:es:shaky-bank",
          name: "Shaky Bank",
        },
        needsAttention: true,
        partial: 0,
        provider: "enable_banking",
        succeeded: 3,
        successRate: 0.25,
      },
      {
        attempts: 40,
        failed: 1,
        failingConnections: 0,
        institution: {
          country: "PT",
          id: "enable_banking:pt:steady-bank",
          name: "Steady Bank",
        },
        needsAttention: false,
        partial: 0,
        provider: "enable_banking",
        succeeded: 39,
        successRate: 0.975,
      },
    ],
    successRateWindowDays: 7,
    ...overrides,
  };
}

function failing(
  overrides: Partial<FailingBankConnections> = {},
): FailingBankConnections {
  return {
    connections: [
      {
        errorCode: "consent_expired",
        failingSince: "2026-11-08T09:00:00.000Z",
        institution: {
          country: "ES",
          id: "enable_banking:es:shaky-bank",
          name: "Shaky Bank",
        },
        lastAttemptAt: "2026-11-12T09:00:00.000Z",
        lastSuccessAt: null,
        provider: "enable_banking",
        status: "expired",
      },
    ],
    generatedAt: "2026-11-12T12:00:00.000Z",
    thresholdHours: 48,
    ...overrides,
  };
}

function renderView(
  props: { failing?: FailingBankConnections; health?: BankSyncHealth } = {},
) {
  render(
    <NextIntlClientProvider locale="en" messages={enAdmin} timeZone="UTC">
      <BankSyncHealthView
        health={props.health ?? health()}
        failing={props.failing ?? failing()}
      />
    </NextIntlClientProvider>,
  );
}

function section(name: string) {
  return screen.getByRole("region", { name });
}

test("shows the page title and the connection counts", () => {
  renderView();

  screen.getByRole("heading", { level: 1, name: copy.title });
  const connections = section(copy["connections-title"]);
  within(connections).getByText(copy.total);
  within(connections).getByText("17");
  within(connections).getByText(copy["status-expired"]);
  within(connections).getByText(copy["status-revoked"]);
  within(connections).getByText("4");
});

test("puts the institution needing attention first, with a labelled badge, and only it", () => {
  renderView();

  const rows = within(section(copy["institutions-title"]))
    .getAllByRole("row")
    .slice(1);
  assert.equal(rows.length, 2);
  within(rows[0]!).getByText("Shaky Bank");
  within(rows[0]!).getByText(copy["needs-attention"]);
  within(rows[0]!).getByText("25%");
  within(rows[1]!).getByText("Steady Bank");
  assert.equal(within(rows[1]!).queryByText(copy["needs-attention"]), null);
});

test("lists error codes for both windows", () => {
  renderView();

  const errors = section(copy["errors-title"]);
  within(errors).getByText(copy["errors-24h"]);
  within(errors).getByText("consent_expired");
  assert.equal(within(errors).getAllByText("rate_limited").length, 2);
});

test("lists each failing connection with its institution, code, status and a missing last success as never", () => {
  renderView();

  const failingSection = section(
    copy["failing-title"].replace("{hours}", "48"),
  );
  const rows = within(failingSection).getAllByRole("row").slice(1);
  assert.equal(rows.length, 1);
  within(rows[0]!).getByText("Shaky Bank");
  within(rows[0]!).getByText("consent_expired");
  within(rows[0]!).getByText(copy["status-expired"]);
  within(rows[0]!).getByText(copy.never);
});

test("says so when nothing is failing and nothing synced", () => {
  renderView({
    failing: failing({ connections: [] }),
    health: health({
      connections: {
        byStatus: {
          authorized: 0,
          created: 0,
          error: 0,
          expired: 0,
          linked: 0,
        },
        failing: 0,
        total: 0,
      },
      incidentsByErrorCode: { last24Hours: [], last7Days: [] },
      institutions: [],
    }),
  });

  screen.getByText(copy["failing-empty"].replace("{hours}", "48"));
  screen.getByText(copy["institutions-empty"].replace("{days}", "7"));
  assert.equal(screen.getAllByText(copy["errors-empty"]).length, 2);
});

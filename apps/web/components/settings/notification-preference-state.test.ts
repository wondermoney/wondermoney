import assert from "node:assert/strict";

import { test } from "vitest";

import {
  buildNotificationPreferencePatch,
  getNotificationPreferenceViewState,
} from "./notification-preference-state";

test("derives active, paused, and off from stored and effective state", () => {
  assert.equal(
    getNotificationPreferenceViewState(
      {
        storedEnabled: true,
        effectiveEnabled: true,
        deliverySupported: true,
      },
      false,
    ).status,
    "active",
  );
  assert.equal(
    getNotificationPreferenceViewState(
      {
        storedEnabled: true,
        effectiveEnabled: false,
        deliverySupported: false,
      },
      false,
    ).status,
    "paused",
  );
  assert.equal(
    getNotificationPreferenceViewState(
      {
        storedEnabled: false,
        effectiveEnabled: false,
        deliverySupported: true,
      },
      false,
    ).status,
    "off",
  );
});

test("allows a stored preference to be disabled while delivery is paused", () => {
  const state = getNotificationPreferenceViewState(
    {
      storedEnabled: true,
      effectiveEnabled: false,
      deliverySupported: false,
    },
    false,
  );

  assert.deepEqual(state, {
    status: "paused",
    pauseReason: "delivery",
    canEnable: false,
    canChange: true,
  });
});

test("only allows an off preference to be enabled when delivery is supported", () => {
  const blocked = getNotificationPreferenceViewState(
    {
      storedEnabled: false,
      effectiveEnabled: false,
      deliverySupported: false,
    },
    false,
  );
  assert.equal(blocked.canEnable, false);
  assert.equal(blocked.canChange, false);

  const eligible = getNotificationPreferenceViewState(
    {
      storedEnabled: false,
      effectiveEnabled: false,
      deliverySupported: true,
    },
    false,
  );
  assert.equal(eligible.canEnable, true);
  assert.equal(eligible.canChange, true);
});

test("uses a generic paused reason for a gated server state without a named failed gate", () => {
  assert.equal(
    getNotificationPreferenceViewState(
      {
        storedEnabled: true,
        effectiveEnabled: false,
        deliverySupported: true,
      },
      false,
    ).pauseReason,
    "generic",
  );
});

test("uses the marketingOptOut pause reason when the global unsubscribe is on", () => {
  assert.equal(
    getNotificationPreferenceViewState(
      {
        storedEnabled: true,
        effectiveEnabled: false,
        deliverySupported: true,
      },
      true,
    ).pauseReason,
    "marketingOptOut",
  );
});

test("category preferences without deliverySupported are always enable-able", () => {
  const active = getNotificationPreferenceViewState(
    { storedEnabled: true, effectiveEnabled: true },
    false,
  );
  assert.equal(active.status, "active");
  assert.equal(active.canEnable, true);

  const pausedByMaster = getNotificationPreferenceViewState(
    { storedEnabled: true, effectiveEnabled: false },
    true,
  );
  assert.deepEqual(pausedByMaster, {
    status: "paused",
    pauseReason: "marketingOptOut",
    canEnable: true,
    canChange: true,
  });

  const off = getNotificationPreferenceViewState(
    { storedEnabled: false, effectiveEnabled: false },
    true,
  );
  assert.equal(off.status, "off");
  assert.equal(off.pauseReason, null);
});

test("builds independent partial PATCH payloads for every stream", () => {
  assert.deepEqual(buildNotificationPreferencePatch("budgetAlerts", true), {
    budgetAlertsEnabled: true,
  });
  assert.deepEqual(buildNotificationPreferencePatch("weeklyInsights", false), {
    weeklyInsightsEnabled: false,
  });
  assert.deepEqual(
    buildNotificationPreferencePatch("accountRecovery", true),
    { accountRecoveryEnabled: true },
  );
});

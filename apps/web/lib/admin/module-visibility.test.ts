import { strict as assert } from "node:assert";

import { test } from "vitest";

import {
  ADMIN_MODULE_IDS,
  createDefaultAdminModuleVisibility,
  createHiddenAdminModuleVisibility,
  createVisibleAdminModuleVisibility,
  normalizeAdminModuleVisibility,
  serializeAdminModuleVisibility,
} from "./module-visibility";

test("defaults every admin module to hidden", () => {
  const visibility = createDefaultAdminModuleVisibility();

  for (const moduleId of ADMIN_MODULE_IDS) {
    assert.equal(visibility[moduleId], false);
  }
});

test("creates a regular-user visibility preset with every module hidden", () => {
  const visibility = createHiddenAdminModuleVisibility();

  for (const moduleId of ADMIN_MODULE_IDS) {
    assert.equal(visibility[moduleId], false);
  }
});

test("creates a show-all visibility preset with every module visible", () => {
  const visibility = createVisibleAdminModuleVisibility();

  for (const moduleId of ADMIN_MODULE_IDS) {
    assert.equal(visibility[moduleId], true);
  }
});

test("normalizes missing and malformed stored values", () => {
  assert.deepEqual(
    normalizeAdminModuleVisibility(
      '{"credits":false,"goals":true,"unknown":false}',
    ),
    {
      credits: false,
      goals: true,
      financialMarkets: false,
      recurring: false,
      assistant: false,
    },
  );

  assert.deepEqual(
    normalizeAdminModuleVisibility("not json"),
    createDefaultAdminModuleVisibility(),
  );
});

test("serializes only known module ids", () => {
  const serialized = serializeAdminModuleVisibility({
    credits: false,
    goals: false,
    financialMarkets: true,
    recurring: false,
    assistant: true,
  });

  assert.equal(
    serialized,
    '{"credits":false,"goals":false,"financialMarkets":true,"recurring":false,"assistant":true}',
  );
});

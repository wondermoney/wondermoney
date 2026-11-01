import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { assertFixtureTarget } from "./portfolio-import-e2e-fixtures.mjs";

const containerId = "a".repeat(64);
const expectedContainerId = "b".repeat(64);

const validEnvironment = (): NodeJS.ProcessEnv => ({
  DB_DATABASE: "wm_issue59_e2e",
  DB_HOST: "127.0.0.1",
  DB_PORT: "55459",
  DATABASE_URL: undefined,
  NODE_ENV: "development",
  WM_E2E_DB_CONTAINER_ID: expectedContainerId,
  WM_E2E_FIXTURES: "1",
});

const validContainer = (overrides: Record<string, unknown> = {}) => ({
  Config: {
    Image: "postgres:17-alpine",
    Labels: { "opencode.disposable": "true", "opencode.owner": "issue59" },
  },
  HostConfig: {
    PortBindings: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55459" }] },
  },
  Id: expectedContainerId,
  Name: "/wm-e2e-pg-55459",
  ...overrides,
});

const invokeGuard = (
  env = validEnvironment(),
  container: unknown = validContainer(),
) => assertFixtureTarget({ env, inspect: () => JSON.stringify(container) });

describe("portfolio import E2E fixture target guard", () => {
  it("accepts an explicitly identified, correctly labelled fresh loopback container", () => {
    assert.doesNotThrow(() => invokeGuard());
  });

  it("requires a full explicit container ID before inspecting Docker", () => {
    for (const value of [undefined, "", "abc", "g".repeat(64)]) {
      let inspected = false;
      const env = { ...validEnvironment(), WM_E2E_DB_CONTAINER_ID: value };
      assert.throws(() => assertFixtureTarget({ env, inspect: () => { inspected = true; return "{}"; } }));
      assert.equal(inspected, false);
    }
  });

  it("rejects an inspected container whose ID differs from the explicit expected ID", () => {
    assert.throws(() => invokeGuard(validEnvironment(), { ...validContainer(), Id: containerId }));
  });

  it("rejects wrong container names, images, or ownership labels", () => {
    const invalidContainers = [
      { ...validContainer(), Name: "/another-postgres" },
      { ...validContainer(), Config: { ...validContainer().Config, Image: "postgres:16" } },
      { ...validContainer(), Config: { ...validContainer().Config, Labels: { "opencode.disposable": "true", "opencode.owner": "someone-else" } } },
      { ...validContainer(), Config: { ...validContainer().Config, Labels: { "opencode.disposable": "false", "opencode.owner": "issue59" } } },
    ];
    for (const container of invalidContainers) assert.throws(() => invokeGuard(validEnvironment(), container));
  });

  it("requires only the exact loopback Postgres port binding", () => {
    const invalidBindings = [
      null,
      "not-json-shape",
      {},
      { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "55459" }] },
      { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55460" }] },
      { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55459" }, { HostIp: "0.0.0.0", HostPort: "55459" }] },
      { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55459" }], "5433/tcp": [{ HostIp: "127.0.0.1", HostPort: "55460" }] },
    ];
    for (const PortBindings of invalidBindings) {
      const container = { ...validContainer(), HostConfig: { PortBindings } };
      assert.throws(() => invokeGuard(validEnvironment(), container));
    }
  });

  it("rejects Docker inspection failures and malformed inspection JSON", () => {
    assert.throws(() => assertFixtureTarget({ env: validEnvironment(), inspect: () => { throw new Error("docker inspect failed"); } }));
    assert.throws(() => assertFixtureTarget({ env: validEnvironment(), inspect: () => "{broken" }));
  });

  it("rejects fixture opt-out, production, and any non-disposable database target", () => {
    const invalidEnvironments: NodeJS.ProcessEnv[] = [
      { ...validEnvironment(), WM_E2E_FIXTURES: "0" },
      { ...validEnvironment(), NODE_ENV: "production" },
      { ...validEnvironment(), DB_HOST: "localhost" },
      { ...validEnvironment(), DB_PORT: "5432" },
      { ...validEnvironment(), DB_DATABASE: "postgres" },
      { ...validEnvironment(), DATABASE_URL: "postgres://invalid-placeholder" },
    ];
    for (const env of invalidEnvironments) {
      let inspected = false;
      assert.throws(() => assertFixtureTarget({ env, inspect: () => { inspected = true; return "{}"; } }));
      assert.equal(inspected, false);
    }
  });
});

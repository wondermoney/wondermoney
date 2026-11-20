import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { keepStationNames, runDailySnapshots, shouldFetch, type DailyJob } from "../../../scripts/build-daily-snapshots.mjs";

const quiet = () => ({ log: vi.fn(), warn: vi.fn() });

describe("the build's daily snapshot step", () => {
  it("fetches for production builds or when asked, never when switched off", () => {
    expect(shouldFetch({})).toBe(false);
    expect(shouldFetch({ VERCEL_ENV: "preview" })).toBe(false);
    expect(shouldFetch({ VERCEL_ENV: "production" })).toBe(true);
    expect(shouldFetch({ LANDING_DAILY_SNAPSHOTS: "1" })).toBe(true);
    expect(shouldFetch({ VERCEL_ENV: "production", LANDING_DAILY_SNAPSHOTS: "0" })).toBe(false);
    expect(shouldFetch({ LANDING_DAILY_SNAPSHOTS: "0" }, { force: true })).toBe(true);
  });

  it("writes station names only inside a Vercel build, never into files that could be committed", () => {
    expect(keepStationNames({ VERCEL: "1", VERCEL_ENV: "production" })).toBe(true);
    expect(keepStationNames({ LANDING_DAILY_SNAPSHOTS: "1" })).toBe(false);
    expect(keepStationNames({ VERCEL_ENV: "production" })).toBe(false);
    expect(keepStationNames({})).toBe(false);
  });

  it("passes the environment to each job", async () => {
    const refresh = vi.fn(async () => "ok");
    const env = { VERCEL: "1", VERCEL_ENV: "production" };
    await runDailySnapshots({ env, jobs: [{ name: "job", refresh, describe: () => "" }], log: quiet() });
    expect(refresh).toHaveBeenCalledWith(expect.any(Function), env);
  });

  it("does nothing outside production", async () => {
    const job: DailyJob = { name: "job", refresh: vi.fn(), describe: () => "" };
    const log = quiet();
    expect(await runDailySnapshots({ env: {}, jobs: [job], log })).toEqual([]);
    expect(job.refresh).not.toHaveBeenCalled();
  });

  it("keeps going when one source fails, warns, and never throws", async () => {
    const log = quiet();
    const jobs: DailyJob[] = [
      { name: "broken", refresh: async () => Promise.reject(new Error("DGEG answered 503")), describe: () => "" },
      { name: "working", refresh: async () => "ok", describe: () => "fresh" },
    ];
    const results = await runDailySnapshots({ env: { VERCEL_ENV: "production" }, jobs, log });
    expect(results).toEqual([
      { name: "broken", ok: false, error: "DGEG answered 503" },
      { name: "working", ok: true },
    ]);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("Keeping the committed snapshot"));
  });

  it("can be made to fail every fetch, to check the fallback", async () => {
    const log = quiet();
    const fetchImpl = vi.fn();
    const job: DailyJob = {
      name: "fetching",
      refresh: async (fetcher) => fetcher("https://example.org"),
      describe: () => "",
    };
    const results = await runDailySnapshots({
      env: { LANDING_DAILY_SNAPSHOTS: "1", LANDING_SNAPSHOT_FETCH_FAIL: "1" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      jobs: [job],
      log,
    });
    expect(results[0]).toMatchObject({ ok: false, error: expect.stringContaining("LANDING_SNAPSHOT_FETCH_FAIL") });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("runs before astro build in the build script", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8"));
    expect(pkg.scripts.build).toMatch(/^node scripts\/build-daily-snapshots\.mjs && astro build/);
  });
});

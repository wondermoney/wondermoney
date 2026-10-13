import assert from "node:assert/strict";

import { test } from "vitest";

import type { RateLimitInfo } from "./rate-limit";
import {
  createRateLimitCoordinator,
  RATE_LIMIT_JITTER_MS,
  RATE_LIMIT_STAGGER_MS,
} from "./rate-limit-coordinator";

const NOW = Date.parse("2026-08-20T12:00:00Z");

function info(seconds: number): RateLimitInfo {
  return {
    retryAfterSeconds: seconds,
    retryAfterMs: seconds * 1000,
    retryAfterKnown: true,
  };
}

function fixedClock(start = NOW) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

test("the first registration opens a window at now + Retry-After", () => {
  const clock = fixedClock();
  const coordinator = createRateLimitCoordinator({
    now: clock.now,
    random: () => 0,
  });

  const registration = coordinator.register(info(30));

  assert.equal(registration.resumeAt, NOW + 30_000);
  assert.equal(registration.retryAt, NOW + 30_000);
  assert.deepEqual(coordinator.getSnapshot(), {
    active: true,
    resumeAt: NOW + 30_000,
    retryAfterSeconds: 30,
    waiterCount: 1,
  });
});

test("a fan-out shares one countdown but resumes staggered", () => {
  const clock = fixedClock();
  const coordinator = createRateLimitCoordinator({
    now: clock.now,
    random: () => 0,
  });

  // Six widgets on one page, all throttled in the same millisecond.
  const registrations = Array.from({ length: 6 }, () =>
    coordinator.register(info(30)),
  );

  const resumeAts = new Set(registrations.map((r) => r.resumeAt));
  assert.equal(resumeAts.size, 1, "one shared countdown");

  const retryAts = registrations.map((r) => r.retryAt);
  assert.equal(new Set(retryAts).size, 6, "six distinct retry moments");

  for (let index = 1; index < retryAts.length; index += 1) {
    assert.equal(
      retryAts[index] - retryAts[index - 1],
      RATE_LIMIT_STAGGER_MS,
      "consecutive waiters are spaced apart",
    );
  }

  assert.equal(coordinator.getSnapshot().waiterCount, 6);
});

test("jitter spreads waiters beyond their stagger slot", () => {
  const clock = fixedClock();
  const randoms = [0.1, 0.9];
  const coordinator = createRateLimitCoordinator({
    now: clock.now,
    random: () => randoms.shift() ?? 0,
  });

  const first = coordinator.register(info(10));
  const second = coordinator.register(info(10));

  assert.equal(first.retryAt, NOW + 10_000 + 0.1 * RATE_LIMIT_JITTER_MS);
  assert.equal(
    second.retryAt,
    NOW + 10_000 + RATE_LIMIT_STAGGER_MS + 0.9 * RATE_LIMIT_JITTER_MS,
  );
});

test("the shared window takes the longest Retry-After anyone was given", () => {
  const clock = fixedClock();
  const coordinator = createRateLimitCoordinator({
    now: clock.now,
    random: () => 0,
  });

  coordinator.register(info(5));
  const later = coordinator.register(info(60));

  assert.equal(later.resumeAt, NOW + 60_000);
  assert.equal(coordinator.getSnapshot().resumeAt, NOW + 60_000);

  // A shorter window arriving afterwards must not pull the resume forward.
  const shorter = coordinator.register(info(5));
  assert.equal(shorter.resumeAt, NOW + 60_000);
});

test("a registration after the window closed starts a fresh slot sequence", () => {
  const clock = fixedClock();
  const coordinator = createRateLimitCoordinator({
    now: clock.now,
    random: () => 0,
  });

  coordinator.register(info(10));
  coordinator.register(info(10));

  clock.advance(11_000);

  const fresh = coordinator.register(info(10));
  assert.equal(fresh.retryAt, fresh.resumeAt, "back to slot 0");
  assert.equal(coordinator.getSnapshot().waiterCount, 1);
});

test("a success closes the window", () => {
  const clock = fixedClock();
  const coordinator = createRateLimitCoordinator({
    now: clock.now,
    random: () => 0,
  });

  coordinator.register(info(30));
  assert.equal(coordinator.getSnapshot().active, true);

  coordinator.noteRecovered();

  assert.equal(coordinator.getSnapshot().active, false);
  assert.equal(coordinator.getSnapshot().resumeAt, null);
});

test("the snapshot expires on its own and keeps a stable identity", () => {
  const clock = fixedClock();
  const coordinator = createRateLimitCoordinator({
    now: clock.now,
    random: () => 0,
  });

  coordinator.register(info(10));
  clock.advance(10_001);

  const first = coordinator.getSnapshot();
  const second = coordinator.getSnapshot();

  assert.equal(first.active, false);
  // useSyncExternalStore compares by identity; a fresh object every read loops.
  assert.equal(first, second);
});

test("subscribers are notified on registration and on recovery", () => {
  const clock = fixedClock();
  const coordinator = createRateLimitCoordinator({
    now: clock.now,
    random: () => 0,
  });

  let notifications = 0;
  const unsubscribe = coordinator.subscribe(() => {
    notifications += 1;
  });

  coordinator.register(info(10));
  coordinator.noteRecovered();
  // Already idle — no second notification.
  coordinator.noteRecovered();

  assert.equal(notifications, 2);

  unsubscribe();
  coordinator.register(info(10));
  assert.equal(notifications, 2);
});

test("getRetryDelayMs honours Retry-After rather than a fixed backoff", () => {
  const clock = fixedClock();
  const coordinator = createRateLimitCoordinator({
    now: clock.now,
    random: () => 0,
  });

  assert.equal(coordinator.getRetryDelayMs(info(45)), 45_000);
});

import assert from "node:assert/strict";

import { test } from "vitest";

import {
  createInitialFirstRunState,
  FIRST_RUN_ONBOARDING_STORAGE_KEY,
  FIRST_RUN_STEPS,
  getFirstRunState,
  getFirstRunStepRoute,
  getNextStep,
  getStepIndex,
  markFirstRunCompleted,
  patchFirstRunState,
  setFirstRunState,
  shouldShowFirstRunOnboarding,
} from ".";

type StorageMap = Map<string, string>;

test("first-run follows the six-step progression and supports back navigation", () => {
  assert.deepEqual(FIRST_RUN_STEPS, [
    "welcome",
    "goals",
    "privacy",
    "account",
    "sync_value",
    "completion",
  ]);

  for (let index = 0; index < FIRST_RUN_STEPS.length - 1; index += 1) {
    const step = FIRST_RUN_STEPS[index] as (typeof FIRST_RUN_STEPS)[number];
    assert.equal(getNextStep(step), FIRST_RUN_STEPS[index + 1]);
    assert.equal(getStepIndex(FIRST_RUN_STEPS[index]), index);
  }

  assert.equal(getFirstRunStepRoute(FIRST_RUN_STEPS[2]), "/onboarding/privacy");
  assert.equal(getFirstRunStepRoute(FIRST_RUN_STEPS[0]), "/onboarding/welcome");
});

test("skipping goals clears the selection and advances to privacy", () => {
  const originalWindow = globalThis.window;
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage, sessionStorage },
  });

  try {
    patchFirstRunState(
      {
        status: "in_progress",
        currentStep: "goals",
        selectedGoals: ["budget"],
      },
      "user-123",
    );
    const skipped = patchFirstRunState(
      { selectedGoals: [], currentStep: "privacy" },
      "user-123",
    );
    assert.deepEqual(skipped.selectedGoals, []);
    assert.equal(skipped.currentStep, "privacy");
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

test("completion marks the six-step flow complete", () => {
  const originalWindow = globalThis.window;
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage, sessionStorage },
  });

  try {
    const completed = markFirstRunCompleted("user-123");
    assert.equal(completed.status, "completed");
    assert.equal(completed.currentStep, "completion");
    assert.equal(shouldShowFirstRunOnboarding("user-123"), false);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

function createStorage(initial: Record<string, string> = {}) {
  const data: StorageMap = new Map(Object.entries(initial));

  return {
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
    clear() {
      data.clear();
    },
    dump() {
      return Object.fromEntries(data.entries());
    },
  };
}

test("unscoped completion is respected for scoped first-run users", () => {
  const originalWindow = globalThis.window;
  const localStorage = createStorage();
  const sessionStorage = createStorage();

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage,
      sessionStorage,
    },
  });

  try {
    const completedState = markFirstRunCompleted();

    assert.equal(completedState.status, "completed");
    assert.equal(shouldShowFirstRunOnboarding("user-123"), false);

    const userState = getFirstRunState("user-123");
    assert.equal(userState.status, "completed");
    assert.equal(userState.currentStep, "completion");
    assert.equal(typeof userState.completedAt, "string");

    const storedScoped = localStorage.getItem(
      `${FIRST_RUN_ONBOARDING_STORAGE_KEY}:user-123`,
    );
    assert.equal(typeof storedScoped, "string");

    assert.equal(shouldShowFirstRunOnboarding("user-456"), true);
    assert.equal(getFirstRunState("user-456").status, "not_started");
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

test("completed unscoped state is consumed even when current user already has scoped state", () => {
  const originalWindow = globalThis.window;
  const localStorage = createStorage();
  const sessionStorage = createStorage();

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage,
      sessionStorage,
    },
  });

  try {
    markFirstRunCompleted();
    setFirstRunState(createInitialFirstRunState(), "user-123");

    assert.equal(shouldShowFirstRunOnboarding("user-123"), true);
    assert.equal(getFirstRunState("user-123").status, "not_started");
    assert.equal(localStorage.getItem(FIRST_RUN_ONBOARDING_STORAGE_KEY), null);

    assert.equal(shouldShowFirstRunOnboarding("user-456"), true);
    assert.equal(getFirstRunState("user-456").status, "not_started");
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

test("stale in-progress completion state is treated as completed for scoped users", () => {
  const originalWindow = globalThis.window;
  const localStorage = createStorage({
    [`${FIRST_RUN_ONBOARDING_STORAGE_KEY}:user-123`]: JSON.stringify({
      status: "in_progress",
      currentStep: "completion",
      selectedGoals: [],
      accountStep: "not_started",
      budgetStep: "not_started",
      portfolioStep: "not_started",
    }),
  });
  const sessionStorage = createStorage();

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage,
      sessionStorage,
    },
  });

  try {
    const state = getFirstRunState("user-123");

    assert.equal(state.status, "completed");
    assert.equal(shouldShowFirstRunOnboarding("user-123"), false);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import { instanceFeatures, queryClientWithInstance } from "@/lib/api/instance/instance-fixture";

import FullLayoutClientOverlays from "./FullLayoutClientOverlays";

// The real launcher is loaded lazily and pulls in the chat stack; a stand-in
// is enough to see whether the overlay mounts it.
vi.mock("next/dynamic", () => ({
  default: () =>
    function AssistantLauncherStub() {
      return <button type="button">Assistant</button>;
    },
}));
// An ordinary account: not on any staff domain, email unconfirmed.
vi.mock("@/lib/auth/user-context", () => ({
  useUser: () => ({ id: "u1", email: "person@example.com", email_confirmed_at: null }),
}));

afterEach(cleanup);

function renderOverlays(features = instanceFeatures()) {
  render(
    <QueryClientProvider client={queryClientWithInstance(features)}>
      <FullLayoutClientOverlays />
    </QueryClientProvider>,
  );
}

test("an ordinary account gets the assistant launcher", () => {
  renderOverlays();

  screen.getByRole("button", { name: "Assistant" });
});

test("a server without an assistant model hides the launcher", () => {
  renderOverlays(instanceFeatures({ ai: { ...instanceFeatures().ai, assistant: false } }));

  assert.equal(screen.queryByRole("button", { name: "Assistant" }), null);
});

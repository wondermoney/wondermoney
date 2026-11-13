// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import { instanceFeatures } from "@/lib/api/instance/instance-fixture";
import type { InstanceDescription } from "@/lib/api/instance/useInstance";

import enCommon from "../../../messages/en/common.json";
import SimplefinConnectButton from "./SimplefinConnectButton";

const state = vi.hoisted(() => ({
  features: {} as InstanceDescription["features"],
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@/lib/api/api", () => ({
  default: { delete: vi.fn(), get: state.get, post: state.post },
}));

// The real selector runs against the features each test sets.
vi.mock("@/lib/api/instance/useInstance", () => ({
  useConfirmedFeature: (
    select: (features: InstanceDescription["features"]) => boolean,
  ) => select(state.features),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  state.get.mockReset();
  state.post.mockReset();
  vi.restoreAllMocks();
});

const m = enCommon.simplefin;
// A synthetic setup token: base64 of a made-up claim URL, built here so no token-shaped literal is committed.
const TOKEN = btoa("https://bridge.simplefin.org/simplefin/claim/TEST");

function renderButton(bankSyncProviders?: string[]) {
  state.features = instanceFeatures({ bankSyncProviders });
  state.get.mockResolvedValue({ data: { connections: [] } });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <NextIntlClientProvider locale="en" messages={enCommon}>
        <SimplefinConnectButton />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

async function openAndPaste(token: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: m.connect }));
  const field = await screen.findByLabelText(m["token-label"]);
  await user.click(field);
  await user.paste(token);
  return { field: field as HTMLTextAreaElement, user };
}

test("offers nothing when the server has not enabled SimpleFIN", () => {
  renderButton(["enable_banking"]);
  assert.equal(screen.queryByRole("button", { name: m.connect }) === null, true);
});

test("offers nothing on an API that does not list its providers", () => {
  renderButton(undefined);
  assert.equal(screen.queryByRole("button", { name: m.connect }) === null, true);
});

test("offers Connect with SimpleFIN when the server lists it, with where to get a token", async () => {
  renderButton(["enable_banking", "simplefin"]);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: m.connect }));

  const link = await screen.findByRole("link", { name: m["get-token"] });
  assert.equal(link.getAttribute("href"), "https://bridge.simplefin.org/");
  const field = screen.getByLabelText(m["token-label"]);
  assert.equal(field.getAttribute("autocomplete"), "off");
  assert.equal(field.getAttribute("spellcheck"), "false");
});

test("posts the setup token once, clears the field as it is sent and stores it nowhere", async () => {
  renderButton(["simplefin"]);
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  let resolve!: (value: unknown) => void;
  state.post.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );

  const { field, user } = await openAndPaste(TOKEN);
  assert.equal(field.value, TOKEN);
  await user.click(screen.getByRole("button", { name: m.submit }));

  await waitFor(() => assert.equal(state.post.mock.calls.length, 1));
  assert.deepEqual(state.post.mock.calls[0], [
    "/v1/banking/simplefin/connections",
    { setupToken: TOKEN },
  ]);
  assert.equal(field.value, "");

  resolve({ data: { connectionId: 7, incidentId: "incident-1" } });
  // A boolean, not the element: a failing assert would inspect the whole jsdom node on every retry.
  await waitFor(() =>
    assert.equal(screen.queryByLabelText(m["token-label"]) === null, true),
  );
  assert.equal(state.post.mock.calls.length, 1);
  for (const [key, value] of setItem.mock.calls) {
    assert.ok(!`${key}${value}`.includes(TOKEN), "the token was stored");
  }
});

test("explains a token the server says was already used, in the person's language", async () => {
  renderButton(["simplefin"]);
  state.post.mockRejectedValue({
    isAxiosError: true,
    response: {
      data: {
        code: "simplefin_token_already_claimed",
        message: "English text from the server",
      },
      status: 400,
    },
  });

  const { user } = await openAndPaste(TOKEN);
  await user.click(screen.getByRole("button", { name: m.submit }));

  const alert = await screen.findByRole("alert");
  assert.equal(alert.textContent, m["error-token-already-claimed"]);
});

test("shows the server's own message for a refusal without a known code", async () => {
  renderButton(["simplefin"]);
  state.post.mockRejectedValue({
    isAxiosError: true,
    response: {
      data: { message: "This setup token was already used." },
      status: 400,
    },
  });

  const { user } = await openAndPaste(TOKEN);
  await user.click(screen.getByRole("button", { name: m.submit }));

  const alert = await screen.findByRole("alert");
  assert.equal(alert.textContent, "This setup token was already used.");
  assert.equal(
    (screen.getByLabelText(m["token-label"]) as HTMLTextAreaElement).value,
    "",
  );
});

test("says SimpleFIN did not respond on a 502, not the server's text", async () => {
  renderButton(["simplefin"]);
  state.post.mockRejectedValue({
    isAxiosError: true,
    response: { data: { message: "upstream detail" }, status: 502 },
  });

  const { user } = await openAndPaste(TOKEN);
  await user.click(screen.getByRole("button", { name: m.submit }));

  const alert = await screen.findByRole("alert");
  assert.equal(alert.textContent, m["error-unreachable"]);
});

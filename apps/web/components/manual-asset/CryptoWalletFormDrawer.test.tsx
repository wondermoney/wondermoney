// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, test, vi } from "vitest";

import type { CryptoChain } from "@/lib/api/manual-asset/types";
import {
  cryptoWallet,
  cryptoWalletAsset,
} from "@/lib/manual-assets/asset-fixture";

import enAssets from "../../messages/en/assets.json";
import enCommon from "../../messages/en/common.json";
import enNavigation from "../../messages/en/navigation.json";
import CryptoWalletFormDrawer from "./CryptoWalletFormDrawer";

const state = vi.hoisted(() => ({
  create: vi.fn(),
  onCreated: vi.fn(),
  onOpenChange: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: state.toastError } }));
vi.mock("@/lib/api/manual-asset/useCryptoWalletMutations", () => ({
  useCreateCryptoWallet: () => ({
    mutateAsync: state.create,
    isPending: false,
  }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  for (const mock of Object.values(state)) mock.mockReset();
});

const m = enAssets.assets;
const w = m.wallet;

// Synthetic values only: a well-known example address, a made-up key and the
// standard test phrase.
const BTC_ADDRESS = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const ETH_ADDRESS = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
// Any 64 hex digits have the shape of a private key; this one is not anybody's.
const HEX_KEY = "ab".repeat(32);
const SEED =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

function renderDrawer(chains: CryptoChain[] = ["bitcoin", "ethereum"]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="en"
        messages={{ ...enCommon, ...enNavigation, ...enAssets }}
      >
        <CryptoWalletFormDrawer
          open
          onOpenChange={state.onOpenChange}
          chains={chains}
          onCreated={state.onCreated}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const addressInputs = () =>
  screen.getAllByLabelText(
    new RegExp(`^(${w.fields.address}|${w.fields.addressOrXpub})`),
  ) as HTMLInputElement[];

test("says plainly that only public addresses are accepted", () => {
  renderDrawer();
  screen.getByText(w.publicOnly.title);
  screen.getByText(w.publicOnly.body);
});

for (const [kind, secret] of [
  ["a private key", HEX_KEY],
  ["a recovery phrase", SEED],
] as const) {
  test(`${kind} is refused before anything is sent, cleared, and never shown back`, async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.type(screen.getByLabelText(new RegExp(m.fields.name)), "Mine");
    const [address] = addressInputs();
    // Pasted, as it would be in real life.
    await user.click(address);
    await user.paste(secret);
    await user.click(screen.getByRole("button", { name: w.actions.add }));

    await screen.findByText(w.errors.secretBlocked);
    assert.equal(state.create.mock.calls.length, 0);
    assert.equal(addressInputs()[0].value, "");
    assert.equal(document.body.innerHTML.includes(secret), false);
    // The toast is never the place for it either.
    assert.equal(state.toastError.mock.calls.length, 0);
  });
}

test("sends the wallet with every address, its network and label", async () => {
  const asset = cryptoWalletAsset({ manualAssetKey: 9 });
  state.create.mockResolvedValue({ asset, wallet: cryptoWallet() });
  const user = userEvent.setup();
  renderDrawer();

  await user.type(
    screen.getByLabelText(new RegExp(m.fields.name)),
    "Hardware wallet",
  );
  await user.type(addressInputs()[0], BTC_ADDRESS);
  await user.type(screen.getByLabelText(w.fields.label), "Cold storage");

  await user.click(screen.getByRole("button", { name: w.actions.addRow }));
  const [, secondChain] = screen.getAllByRole("combobox");
  await user.click(secondChain);
  await user.click(
    await screen.findByRole("option", { name: w.chains.ethereum }),
  );
  await user.type(addressInputs()[1], ETH_ADDRESS);
  await user.click(screen.getByRole("switch"));
  await user.click(screen.getByRole("button", { name: w.actions.add }));

  await waitFor(() => assert.equal(state.create.mock.calls.length, 1));
  assert.deepEqual(state.create.mock.calls[0][0], {
    name: "Hardware wallet",
    isPrivate: true,
    notes: null,
    addresses: [
      { chain: "bitcoin", address: BTC_ADDRESS, label: "Cold storage" },
      { chain: "ethereum", address: ETH_ADDRESS, label: null },
    ],
  });
  assert.deepEqual(state.onCreated.mock.calls, [[asset]]);
  assert.deepEqual(state.onOpenChange.mock.calls, [[false]]);
});

test("offers only the networks the server can read", async () => {
  const user = userEvent.setup();
  renderDrawer(["ethereum"]);

  await user.click(screen.getByRole("combobox"));
  const options = await screen.findAllByRole("option");
  assert.deepEqual(
    options.map((option) => option.textContent),
    [w.chains.ethereum],
  );
});

function apiError(status: number, code: string, details?: object) {
  return new AxiosError("Bad", String(status), undefined, undefined, {
    status,
    statusText: "Bad",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { code, message: "Server wording", details },
  });
}

test("the server refusing a secret clears the address it names, in the reader's words", async () => {
  state.create.mockRejectedValue(
    apiError(400, "crypto_wallet_secret_rejected", { addressIndex: "0" }),
  );
  const user = userEvent.setup();
  renderDrawer();

  await user.type(screen.getByLabelText(new RegExp(m.fields.name)), "Mine");
  // Wide enough to pass the local check; the server knows better.
  await user.type(addressInputs()[0], "bc1qnotreallyanaddressbutnotasecret");
  await user.click(screen.getByRole("button", { name: w.actions.add }));

  await screen.findByText(w.errors.secretBlocked);
  assert.equal(addressInputs()[0].value, "");
  assert.equal(screen.queryByText("Server wording"), null);
});

test("an invalid or duplicate address is marked on its row; a network the server cannot read is said", async () => {
  state.create.mockRejectedValueOnce(
    apiError(400, "crypto_wallet_address_invalid", { addressIndex: "0" }),
  );
  const user = userEvent.setup();
  renderDrawer();

  await user.type(screen.getByLabelText(new RegExp(m.fields.name)), "Mine");
  await user.type(addressInputs()[0], BTC_ADDRESS);
  await user.click(screen.getByRole("button", { name: w.actions.add }));
  await screen.findByText(w.errors.addressInvalid);

  state.create.mockRejectedValueOnce(apiError(501, "feature_disabled"));
  await user.click(screen.getByRole("button", { name: w.actions.add }));
  await waitFor(() =>
    assert.deepEqual(state.toastError.mock.calls, [[w.errors.featureDisabled]]),
  );
});

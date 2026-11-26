// @vitest-environment jsdom
import assert from "node:assert/strict";

import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, beforeAll, test, vi } from "vitest";

import { instanceFeatures, queryClientWithInstance } from "@/lib/api/instance/instance-fixture";
import { profileQueryKey } from "@/lib/api/user/useProfile";
import { getFirstRunState } from "@/lib/onboarding/firstRunOnboarding";

import enCommon from "../../messages/en/common.json";
import enOnboarding from "../../messages/en/onboarding.json";
import FirstRunAccountStep from "../onboarding/first-run/FirstRunAccountStep";
import AccountCreateModal from "./AccountCreateModal";
import AccountCreateSyncModal from "./AccountCreateSyncModal";

/*
 * The "add your Enable Banking key" step is skipped when the server's shared credential covers
 * the person's household, and explained when the server has one that does not.
 */

const server = vi.hoisted(() => ({
  bankListRequests: 0,
  ownCredential: null as null | { pending?: { expiresAt: string }; status: string },
  household: null as null | object,
  post: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/api/api", () => ({
  default: {
    get: (url: string) => {
      if (url === "/v1/user/enable-banking-credential") return Promise.resolve({ data: server.ownCredential });
      if (url === "/v1/household" && server.household) return Promise.resolve({ data: server.household });
      if (url === "/v1/banking/connections") return Promise.resolve({ data: { connections: [] } });
      if (url === "/v1/banking/bank") {
        server.bankListRequests += 1;
        return Promise.resolve({ data: [{ country: "PT", id: "BANK_1", logo: null, name: "Banco Exemplo" }] });
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    },
    post: server.post,
  },
}));
vi.mock("posthog-js/react", () => ({ usePostHog: () => ({ capture: () => {} }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
  usePathname: () => "/onboarding/account",
  useRouter: () => ({ push: server.push, refresh: () => {}, replace: () => {} }),
}));
vi.mock("@/lib/auth/user-context", () => ({ useUser: () => ({ id: "user-1" }) }));
vi.mock("@/lib/auth/client", () => ({ authClient: { useSession: () => ({ data: { user: { id: "user-1" } } }) } }));
vi.mock("../onboarding/first-run/FirstRunOnboardingRouteShell", () => ({ useFirstRunOnboardingFooter: () => () => {} }));
vi.mock("@/lib/api/banking/useCreateRequisition", () => ({ default: () => ({ data: undefined, isError: false, isFetching: false, refetch: () => {} }) }));
vi.mock("@/lib/api/account/useCreateOfflineAccount", () => ({ default: () => ({ mutateAsync: () => Promise.resolve() }) }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
  window.matchMedia ??= ((query: string) => ({
    addEventListener: () => {},
    matches: true,
    media: query,
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  server.bankListRequests = 0;
  server.ownCredential = null;
  server.household = null;
  server.post.mockReset();
  server.push.mockReset();
});

type Credentials = "instance" | "user";

function renderWith(
  node: React.ReactNode,
  { bankSyncProviders, household, instance }: { bankSyncProviders?: string[]; household: Credentials; instance: Credentials },
) {
  const client = queryClientWithInstance(instanceFeatures({ bankSyncCredentials: instance, bankSyncProviders }));
  client.setQueryData(profileQueryKey, { bankSyncCredentials: household });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ ...enCommon, ...enOnboarding }}>
        {node}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const credentialStepTitle = enCommon.bankProviderCredentialRequired.title;
const sharedUnavailable = enCommon.bankProviderCredentialRequired.sharedUnavailable;

test("the bank picker opens straight on the bank list when the shared credential covers the household", async () => {
  renderWith(<AccountCreateSyncModal isOpen setOpen={() => {}} />, { household: "instance", instance: "instance" });

  assert.ok(await screen.findByText("Banco Exemplo"));
  assert.equal(screen.queryByText(credentialStepTitle), null);
});

test("the bank picker asks for a key, and says why, when the shared credential serves another household", async () => {
  renderWith(<AccountCreateSyncModal isOpen setOpen={() => {}} />, { household: "user", instance: "instance" });

  assert.ok(await screen.findByText(credentialStepTitle));
  assert.ok(screen.getByText(sharedUnavailable));
  assert.equal(server.bankListRequests, 0);
});

test("the bank picker asks for a key, without the explanation, on a server with no shared credential", async () => {
  renderWith(<AccountCreateSyncModal isOpen setOpen={() => {}} />, { household: "user", instance: "user" });

  assert.ok(await screen.findByText(credentialStepTitle));
  assert.equal(screen.queryByText(sharedUnavailable), null);
});

test("a key of the user's own still opens the bank list", async () => {
  server.ownCredential = { status: "active" };
  renderWith(<AccountCreateSyncModal isOpen setOpen={() => {}} />, { household: "user", instance: "user" });

  assert.ok(await screen.findByText("Banco Exemplo"));
});

test("the add-account chooser offers a linked account when the shared credential covers the household", async () => {
  renderWith(
    <AccountCreateModal isOpen setOpen={() => {}} onAddOfflineAccountClick={() => {}} onAddSyncAccountClick={() => {}} trigger={false} />,
    { household: "instance", instance: "instance" },
  );

  assert.ok(await screen.findByText(enCommon.linked));
  assert.equal(screen.queryByText(credentialStepTitle), null);
});

test("the add-account chooser leaves Enable Banking out, and offers SimpleFIN, on a SimpleFIN-only server", async () => {
  renderWith(
    <AccountCreateModal isOpen setOpen={() => {}} onAddOfflineAccountClick={() => {}} onAddSyncAccountClick={() => {}} trigger={false} />,
    { bankSyncProviders: ["simplefin"], household: "user", instance: "user" },
  );

  assert.ok(await screen.findByText(enCommon.simplefin.offer));
  assert.ok(screen.getByText(enCommon.unlinked));
  assert.equal(screen.queryByText(enCommon.linked), null);
  assert.equal(screen.queryByText(credentialStepTitle), null);
});

test("the add-account chooser offers both providers when both are on", async () => {
  renderWith(
    <AccountCreateModal isOpen setOpen={() => {}} onAddOfflineAccountClick={() => {}} onAddSyncAccountClick={() => {}} trigger={false} />,
    { bankSyncProviders: ["enable_banking", "simplefin"], household: "instance", instance: "instance" },
  );

  assert.ok(await screen.findByText(enCommon.linked));
  assert.ok(screen.getByText(enCommon.simplefin.offer));
});

test("first-run onboarding lists banks when the shared credential covers the household", async () => {
  renderWith(<FirstRunAccountStep />, { household: "instance", instance: "instance" });

  assert.ok(await screen.findByText("Banco Exemplo"));
  assert.equal(screen.queryByText(enOnboarding.onboarding.firstRun.account.credentialRequired.title), null);
});

test("first-run onboarding explains the missing key when the shared credential serves another household", async () => {
  renderWith(<FirstRunAccountStep />, { household: "user", instance: "instance" });

  assert.ok(await screen.findByText(enOnboarding.onboarding.firstRun.account.credentialRequired.title));
  assert.ok(screen.getByText(sharedUnavailable));
});

const onboarding = enOnboarding.onboarding.firstRun;

test("first-run onboarding offers SimpleFIN only on a server that enables it", async () => {
  renderWith(<FirstRunAccountStep />, { bankSyncProviders: ["enable_banking"], household: "instance", instance: "instance" });

  assert.ok(await screen.findByText("Banco Exemplo"));
  assert.equal(screen.queryByText(enCommon.simplefin.offer), null);
  assert.equal(screen.queryByRole("button", { name: enCommon.simplefin.connect }), null);
});

test("first-run onboarding offers SimpleFIN beside the bank list when both providers are on", async () => {
  renderWith(<FirstRunAccountStep />, { bankSyncProviders: ["enable_banking", "simplefin"], household: "instance", instance: "instance" });

  assert.ok(await screen.findByText("Banco Exemplo"));
  assert.ok(screen.getByText(enCommon.simplefin.offer));
  assert.ok(screen.getByRole("button", { name: enCommon.simplefin.connect }));
});

test("first-run onboarding leaves Enable Banking out on a SimpleFIN-only server", async () => {
  renderWith(<FirstRunAccountStep />, { bankSyncProviders: ["simplefin"], household: "user", instance: "user" });

  assert.ok(await screen.findByText(enCommon.simplefin.offer));
  assert.ok(screen.getByRole("button", { name: onboarding.account.manualCta }));
  assert.equal(screen.queryByLabelText(onboarding.connect.countryLabel), null);
  assert.equal(screen.queryByText(onboarding.account.credentialRequired.title), null);
  assert.equal(server.bankListRequests, 0);
});

test("connecting SimpleFIN in first-run onboarding records a connected account and moves to the sync step", async () => {
  server.post.mockResolvedValue({ data: { connectionId: 7, incidentId: "incident-1" } });
  renderWith(<FirstRunAccountStep />, { bankSyncProviders: ["simplefin"], household: "user", instance: "user" });
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: enCommon.simplefin.connect }));
  await user.click(await screen.findByLabelText(enCommon.simplefin["token-label"]));
  // A synthetic setup token: base64 of a made-up claim URL, built here so no token-shaped literal is committed.
  await user.paste(btoa("https://bridge.simplefin.org/simplefin/claim/TEST"));
  await user.click(screen.getByRole("button", { name: enCommon.simplefin.submit }));

  await waitFor(() => assert.deepEqual(server.push.mock.calls, [["/onboarding/sync"]]));
  assert.equal(server.post.mock.calls[0]?.[0], "/v1/banking/simplefin/connections");
  assert.equal(getFirstRunState("user-1").accountStep, "connected");
});

/*
 * Without a key, every way to a bank list opens the Enable Banking setup wizard, and finishing it
 * lands on that bank list. The server's answers stand in for Enable Banking's Control Panel.
 */

const wizard = enCommon.bankProvider.wizard;
const APPLICATION_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

function answerSetupRequests() {
  server.post.mockImplementation((url: string) => {
    if (url === "/v1/user/enable-banking-credential/certificate") {
      server.ownCredential = { pending: { expiresAt: "2026-12-03T00:00:00.000Z" }, status: "pending" };
      return Promise.resolve({
        data: { certificatePem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n", expiresAt: "2026-12-03T00:00:00.000Z" },
      });
    }
    if (url === "/v1/user/enable-banking-credential/activate") {
      server.ownCredential = { status: "active" };
      return Promise.resolve({ data: { applicationId: APPLICATION_ID, status: "active" } });
    }
    return Promise.reject(new Error(`unexpected POST ${url}`));
  });
}

/** Steps 1 to 5, as a person would: the Control Panel's part happens in its own tab. */
async function walkTheWizard(user: ReturnType<typeof userEvent.setup>) {
  assert.ok(await screen.findByRole("heading", { name: wizard.signIn.title }));
  await user.click(screen.getByRole("button", { name: wizard.next }));
  assert.ok(screen.getByRole("heading", { name: wizard.create.title }));
  await user.click(screen.getByRole("button", { name: enCommon.bankProvider.generated.create }));
  await screen.findByRole("button", { name: enCommon.bankProvider.generated.download });
  await user.click(screen.getByRole("button", { name: wizard.next }));
  assert.ok(screen.getByRole("heading", { name: wizard.activate.title }));
  await user.click(screen.getByRole("button", { name: wizard.next }));
  await user.click(screen.getByLabelText(wizard.applicationId.label));
  await user.paste(APPLICATION_ID);
  assert.ok(await screen.findByRole("heading", { name: wizard.done.title }));
  await user.click(screen.getByRole("button", { name: wizard.done.chooseBank }));
}

test("first run: without a key, the setup wizard runs from the account step and ends on the bank list", async () => {
  answerSetupRequests();
  renderWith(<FirstRunAccountStep />, { household: "user", instance: "user" });
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: enCommon.bankProviderCredentialRequired.cta }));
  await walkTheWizard(user);

  assert.ok(await screen.findByText("Banco Exemplo"));
  assert.equal(screen.queryByText(onboarding.account.credentialRequired.title), null);
  assert.deepEqual(
    server.post.mock.calls.map(([url]) => url),
    ["/v1/user/enable-banking-credential/certificate", "/v1/user/enable-banking-credential/activate"],
  );
});

test("the add-account chooser's linked option opens the setup wizard, which goes on to the bank list", async () => {
  answerSetupRequests();
  const onAddSyncAccountClick = vi.fn();
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <AccountCreateModal
        isOpen={open}
        setOpen={setOpen}
        onAddOfflineAccountClick={() => {}}
        onAddSyncAccountClick={onAddSyncAccountClick}
        trigger={false}
      />
    );
  }
  renderWith(<Host />, { household: "user", instance: "user" });
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: new RegExp(enCommon.bankProviderCredentialRequired.cta) }));
  await walkTheWizard(user);

  assert.equal(onAddSyncAccountClick.mock.calls.length, 1);
});

test("the bank picker without a key opens the setup wizard and comes back to the bank list", async () => {
  answerSetupRequests();
  function Host() {
    const [open, setOpen] = useState(true);
    return <AccountCreateSyncModal isOpen={open} setOpen={setOpen} />;
  }
  renderWith(<Host />, { household: "user", instance: "user" });
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: enCommon.bankProviderCredentialRequired.cta }));
  await walkTheWizard(user);

  assert.ok(await screen.findByText("Banco Exemplo"));
});

test("with the server's own application covering the household, no entry point offers the wizard", async () => {
  renderWith(<FirstRunAccountStep />, { household: "instance", instance: "instance" });

  assert.ok(await screen.findByText("Banco Exemplo"));
  assert.equal(screen.queryByRole("button", { name: enCommon.bankProviderCredentialRequired.cta }), null);
});

test("a household viewer, who cannot link a bank, is not offered the setup from the add-account chooser", async () => {
  server.household = {
    maxMembers: 6,
    members: [{ appuserKey: 2, emailAddress: "viewer@example.test", name: "Viewer", role: "viewer" }],
    pendingInvites: [],
    viewerAppuserKey: 2,
  };
  renderWith(
    <AccountCreateModal isOpen setOpen={() => {}} onAddOfflineAccountClick={() => {}} onAddSyncAccountClick={() => {}} trigger={false} />,
    { household: "user", instance: "user" },
  );

  assert.ok(await screen.findByText(enCommon.bankProviderCredentialRequired.body));
  await waitFor(() =>
    assert.equal(screen.queryByRole("button", { name: new RegExp(enCommon.bankProviderCredentialRequired.cta) }), null),
  );
});

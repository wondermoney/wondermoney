// @vitest-environment jsdom
import assert from "node:assert/strict";

import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeAll, test, vi } from "vitest";

import { NotFoundState } from "@/components/error/NotFoundState";
import { instanceFeatures, queryClientWithInstance } from "@/lib/api/instance/instance-fixture";

import enMessages from "../../messages/en/common.json";
import Feedback from "./Feedback";

vi.mock("@/i18n/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/components/ui/Link", () => ({
  Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("posthog-js/react", () => ({ usePostHog: () => ({ capture: () => {} }) }));

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

function renderWith(node: ReactNode, client: QueryClient) {
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {node}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const mailtoLinks = () =>
  Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:"]')).map((link) => link.href);

for (const [name, node] of [
  ["feedback panel", <Feedback key="feedback" />],
  ["not-found page", <NotFoundState key="not-found" />],
] as const) {
  test(`the ${name} points to the instance's own support address`, () => {
    renderWith(node, queryClientWithInstance(instanceFeatures(), { supportEmail: "help@money.example.com" }));
    assert.deepEqual(mailtoLinks(), ["mailto:help@money.example.com"]);
  });

  test(`the ${name} offers no support address on an instance without one`, () => {
    renderWith(node, queryClientWithInstance(instanceFeatures({ contactForm: false }), { supportEmail: null }));
    assert.deepEqual(mailtoLinks(), []);
    assert.equal(screen.queryByText(/wonder\.money/i), null);
  });
}
